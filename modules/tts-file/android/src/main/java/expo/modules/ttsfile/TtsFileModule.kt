package expo.modules.ttsfile

import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import androidx.core.os.bundleOf
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.Closeable
import java.io.File
import java.io.FileInputStream
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

private const val ROOT_FOLDER = "Music/스텝바이"
private const val AAC_BITRATE = 64000
private const val CODEC_TIMEOUT_US = 10_000L

// 조각 사이에 넣는 실제 무음 길이. 저장은 줄 단위로 통째 합성하고(segmentForSave),
// 조각마다 엔진이 앞뒤에 붙이는 들쭉날쭉한 무음은 잘라낸 뒤 이 값으로 다시 채운다 —
// 그래야 줄·문단 사이 쉼이 일정하다. SENTENCE 는 한 줄이 엔진 한도를 넘어
// 문장 경계에서 나눴을 때만 쓰인다.
private const val CLAUSE_PAUSE_SEC = 0.15
private const val SENTENCE_PAUSE_SEC = 0.35
private const val LINE_PAUSE_SEC = 0.5
private const val PARAGRAPH_PAUSE_SEC = 0.9

// 엔진이 만든 조각 앞뒤의 무음을 자를 때, 말소리로 볼 최소 크기(16비트 기준 약 -42dB)와
// 말소리 앞뒤로 남겨 둘 여유. ㅅ·ㅎ 같은 약한 첫소리나 끝음절 꼬리가 잘리지 않게 넉넉히 남긴다.
private const val SPEECH_THRESHOLD = 260
private const val KEEP_BEFORE_MS = 60
private const val KEEP_AFTER_MS = 120
private const val FADE_MS = 6

// saveToFile 은 이미 인자 7개(+ Promise) 로 expo-modules-core 가 지원하는
// AsyncFunction 최대 개수를 다 쓰고 있다. texts/gaps 를 따로 받으면 8개가 되어
// 컴파일이 안 된다(Function9 지원 안 함) — 그래서 텍스트와 간격을 한 덩어리로 묶는다.
class SpeechSegment : Record {
  @Field
  val text: String = ""

  @Field
  val gap: String = "none"
}

class TtsFileModule : Module() {
  private var engine: TextToSpeech? = null

  // 지금 붙어 있는 엔진의 패키지명. null 이면 시스템 기본 엔진이다.
  // 다른 엔진을 요청받으면 이 값과 비교해서 갈아끼운다.
  private var enginePackage: String? = null

  private val context: Context
    get() = appContext.reactContext ?: throw CodedException("앱 컨텍스트를 찾을 수 없습니다.")

  override fun definition() = ModuleDefinition {
    Name("TtsFile")
    Events("onProgress", "onSpeakDone", "onSpeakError")

    // 폰에 깔린 TTS 엔진 목록 (삼성 TTS, Google TTS 등).
    // 엔진마다 목소리가 완전히 다르고, 시스템 기본 엔진 하나만 쓰면 나머지는
    // 앱에서 아예 안 보인다. 그래서 엔진 자체를 고를 수 있게 목록을 넘긴다.
    AsyncFunction("listEngines") { promise: Promise ->
      Thread {
        try {
          val tts = awaitEngine(null)
          val default = tts.defaultEngine
          promise.resolve(
            tts.engines.map { info ->
              bundleOf(
                "packageName" to info.name,
                "label" to (info.label ?: info.name),
                "isSystemDefault" to (info.name == default)
              )
            }
          )
        } catch (e: Exception) {
          resetEngine()
          promise.reject(CodedException("엔진 목록을 읽지 못했습니다: ${e.message}"))
        }
      }.start()
    }

    // 폰에 설치된 음성 목록.
    // expo-speech 는 엔진 초기화가 한 번이라도 실패하면 내부 상태가 FAILED 로 굳어서,
    // 앱을 완전히 껐다 켜기 전까지 계속 빈 목록만 돌려준다(되돌리는 코드가 없다).
    // 그래서 여기서 직접 엔진을 잡고, 실패하면 엔진을 버리고 새로 만들어 다시 물어본다.
    AsyncFunction("listVoices") { enginePkg: String?, promise: Promise ->
      Thread {
        try {
          promise.resolve(readVoices(enginePkg))
        } catch (e: Exception) {
          resetEngine()
          promise.reject(CodedException("음성 목록을 읽지 못했습니다: ${e.message}"))
        }
      }.start()
    }

    // 앱을 열 때 미리 엔진을 깨워 둔다.
    // 시스템 TTS 서비스가 붙기 전에 expo-speech 가 먼저 건드리면 그대로 굳어버리므로,
    // 복구 가능한 이쪽 엔진으로 먼저 붙여 놓는다.
    AsyncFunction("prepareEngine") { enginePkg: String?, promise: Promise ->
      Thread {
        try {
          awaitEngine(enginePkg)
          promise.resolve(true)
        } catch (e: Exception) {
          resetEngine()
          promise.resolve(false)
        }
      }.start()
    }

    // 읽기·미리듣기. 예전엔 expo-speech 로 했는데, 그건 시스템 기본 엔진만 쓰기 때문에
    // 삼성 음성을 골라 놓고 미리듣기를 하면 Google 목소리가 나온다.
    // 여기로 돌리면 고른 엔진 그대로 들린다.
    // id 는 JS 가 정해서 넘긴다. 네이티브가 만들어 돌려주면, 짧은 구간에서
    // onSpeakDone 이벤트가 promise 보다 먼저 도착해 JS 가 누구 것인지 모른다.
    AsyncFunction("speak") { text: String,
                             id: String,
                             enginePkg: String?,
                             voice: String?,
                             rate: Float,
                             pitch: Float,
                             promise: Promise ->
      Thread {
        try {
          val tts = awaitEngine(enginePkg)
          applyVoice(tts, voice, rate, pitch)

          tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) = Unit

            override fun onDone(utteranceId: String?) {
              sendEvent("onSpeakDone", bundleOf("id" to utteranceId))
            }

            @Deprecated("레거시 콜백이지만 구형 엔진이 여전히 호출한다.")
            override fun onError(utteranceId: String?) {
              sendEvent("onSpeakError", bundleOf("id" to utteranceId, "code" to -1))
            }

            override fun onError(utteranceId: String?, errorCode: Int) {
              sendEvent("onSpeakError", bundleOf("id" to utteranceId, "code" to errorCode))
            }
          })

          val params = Bundle().apply {
            putString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, id)
          }
          if (tts.speak(text, TextToSpeech.QUEUE_FLUSH, params, id) != TextToSpeech.SUCCESS) {
            throw CodedException("읽기를 시작하지 못했습니다.")
          }
          promise.resolve(true)
        } catch (e: CodedException) {
          promise.reject(e)
        } catch (e: Exception) {
          resetEngine()
          promise.reject(CodedException(e.message ?: "읽기에 실패했습니다."))
        }
      }.start()
    }

    AsyncFunction("stopSpeaking") { promise: Promise ->
      Thread {
        runCatching { engine?.stop() }
        promise.resolve(true)
      }.start()
    }

    // 재생과 무관하게, 텍스트 구간들을 합성해 하나의 m4a 로 저장한다.
    // 각 구간의 gap 은 그 구간 "다음"에 얼마나 쉴지를 적어 둔다("line" | "para" | "none")
    // — CreateScreen 의 segmentText 가 만든다.
    AsyncFunction("saveToFile") { segments: List<SpeechSegment>,
                                  enginePkg: String?,
                                  voice: String?,
                                  rate: Float,
                                  pitch: Float,
                                  fileName: String,
                                  folder: String?,
                                  promise: Promise ->
      Thread {
        val workDir = File(context.cacheDir, "tts-parts").apply {
          deleteRecursively()
          mkdirs()
        }
        try {
          requireQ()
          if (segments.isEmpty()) throw CodedException("저장할 텍스트가 없습니다.")

          val tts = awaitEngine(enginePkg)
          val parts = synthesize(tts, segments, voice, rate, pitch, workDir)

          val target = File(workDir, "out.m4a")
          encodeToM4a(parts, target)

          val relativePath = folderPath(folder)
          val uri = copyToMusicFolder(target, "$fileName.m4a", relativePath)

          promise.resolve(
            bundleOf(
              "uri" to uri,
              "path" to "$relativePath/$fileName.m4a",
              "bytes" to target.length()
            )
          )
        } catch (e: CodedException) {
          promise.reject(e)
        } catch (e: Throwable) {
          promise.reject(CodedException(e.message ?: "오디오 저장에 실패했습니다.", e))
        } finally {
          workDir.deleteRecursively()
        }
      }.start()
    }

    // 서재 목록. 스텝바이가 만든 폴더 아래의 오디오를 전부 훑는다.
    AsyncFunction("listLibrary") { promise: Promise ->
      Thread {
        try {
          requireQ()
          promise.resolve(queryLibrary())
        } catch (e: CodedException) {
          promise.reject(e)
        } catch (e: Throwable) {
          promise.reject(CodedException(e.message ?: "목록을 불러오지 못했습니다.", e))
        }
      }.start()
    }

    AsyncFunction("deleteItem") { uri: String, promise: Promise ->
      Thread {
        try {
          val removed = context.contentResolver.delete(Uri.parse(uri), null, null)
          if (removed <= 0) throw CodedException("파일을 지우지 못했습니다.")
          promise.resolve(true)
        } catch (e: Throwable) {
          promise.reject(CodedException(e.message ?: "삭제에 실패했습니다.", e))
        }
      }.start()
    }

    // 과목 이동 — MediaStore 의 상대 경로만 바꾸면 파일이 그 폴더로 옮겨진다.
    AsyncFunction("moveItem") { uri: String, folder: String?, promise: Promise ->
      Thread {
        try {
          requireQ()
          val values = ContentValues().apply {
            put(MediaStore.Audio.Media.RELATIVE_PATH, folderPath(folder))
          }
          val updated = context.contentResolver.update(Uri.parse(uri), values, null, null)
          if (updated <= 0) throw CodedException("파일을 옮기지 못했습니다.")
          promise.resolve(true)
        } catch (e: Throwable) {
          promise.reject(CodedException(e.message ?: "이동에 실패했습니다.", e))
        }
      }.start()
    }

    AsyncFunction("renameItem") { uri: String, name: String, promise: Promise ->
      Thread {
        try {
          val values = ContentValues().apply {
            put(MediaStore.Audio.Media.DISPLAY_NAME, name)
          }
          val updated = context.contentResolver.update(Uri.parse(uri), values, null, null)
          if (updated <= 0) throw CodedException("이름을 바꾸지 못했습니다.")
          promise.resolve(true)
        } catch (e: Throwable) {
          promise.reject(CodedException(e.message ?: "이름 변경에 실패했습니다.", e))
        }
      }.start()
    }

    OnDestroy {
      engine?.shutdown()
      engine = null
    }
  }

  private fun requireQ() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      throw CodedException("안드로이드 10 이상에서만 지원합니다.")
    }
  }

  private fun folderPath(folder: String?): String {
    val clean = folder
      ?.trim()
      ?.replace(Regex("[\\\\/:*?\"<>|]"), " ")
      ?.trim()

    return if (clean.isNullOrEmpty()) ROOT_FOLDER else "$ROOT_FOLDER/$clean"
  }

  // 목록이 비어 있으면 엔진이 상한 것으로 보고, 버리고 새 엔진으로 한 번 더 물어본다.
  private fun readVoices(enginePkg: String?): List<Bundle> {
    repeat(2) { attempt ->
      val voices = try {
        awaitEngine(enginePkg).voices
      } catch (e: Exception) {
        null
      }

      if (!voices.isNullOrEmpty()) {
        return voices.mapNotNull { voice -> voiceToBundle(voice) }
      }

      resetEngine()
      if (attempt == 0) Thread.sleep(400)
    }

    return emptyList()
  }

  private fun voiceToBundle(voice: Voice): Bundle? {
    val locale = voice.locale ?: return null
    val language = locale.toLanguageTag()

    return bundleOf(
      "identifier" to voice.name,
      "name" to voice.name,
      "language" to language,
      "quality" to if (voice.quality > Voice.QUALITY_NORMAL) "Enhanced" else "Default",
      // 네트워크가 필요한 음성은 비행기 모드나 데이터가 없을 때 소리가 안 난다.
      "networkRequired" to voice.isNetworkConnectionRequired
    )
  }

  private fun resetEngine() {
    engine?.let { runCatching { it.shutdown() } }
    engine = null
    enginePackage = null
  }

  // pkg 가 null 이면 시스템 기본 엔진. 붙어 있는 엔진과 다른 걸 요청하면
  // 기존 걸 닫고 새로 붙인다 — TextToSpeech 인스턴스 하나는 엔진 하나에만 묶인다.
  private fun awaitEngine(pkg: String?): TextToSpeech {
    val want = pkg?.takeIf { it.isNotBlank() }

    engine?.let { if (want == enginePackage) return it }
    resetEngine()

    val ready = CountDownLatch(1)
    var status = TextToSpeech.ERROR
    val listener = TextToSpeech.OnInitListener { result ->
      status = result
      ready.countDown()
    }
    val tts = if (want == null) {
      TextToSpeech(context, listener)
    } else {
      TextToSpeech(context, listener, want)
    }

    if (!ready.await(15, TimeUnit.SECONDS) || status != TextToSpeech.SUCCESS) {
      tts.shutdown()
      // 삼성 TTS 처럼 자사 앱만 허용하는 엔진이 있다. 목록에는 보이지만
      // 붙으려 하면 "not allowed to bind to private engine" 으로 거부당한다.
      throw CodedException(
        if (want == null) "TTS 엔진을 초기화하지 못했습니다."
        else "이 엔진은 다른 앱에서 쓸 수 없습니다. 다른 엔진을 골라 주세요."
      )
    }

    engine = tts
    enginePackage = want
    return tts
  }

  // 읽기와 파일 합성이 같은 설정을 쓰도록 한 군데로 모아 둔다.
  private fun applyVoice(tts: TextToSpeech, voiceId: String?, rate: Float, pitch: Float) {
    tts.language = Locale.KOREAN
    tts.setSpeechRate(rate)
    tts.setPitch(pitch)
    if (voiceId != null) {
      tts.voices?.firstOrNull { it.name == voiceId }?.let { tts.voice = it }
    }
  }

  private fun synthesize(
    tts: TextToSpeech,
    segments: List<SpeechSegment>,
    voiceId: String?,
    rate: Float,
    pitch: Float,
    dir: File
  ): List<AudioPart> {
    applyVoice(tts, voiceId, rate, pitch)

    val parts = mutableListOf<AudioPart>()

    segments.forEachIndexed { index, segment ->
      val text = segment.text
      val target = File(dir, "part_$index.wav")
      val utteranceId = "stepby_$index"
      val done = CountDownLatch(1)
      var failed = false

      tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
        override fun onStart(id: String?) = Unit

        override fun onDone(id: String?) {
          if (id == utteranceId) done.countDown()
        }

        @Deprecated("레거시 콜백이지만 구형 엔진이 여전히 호출한다.")
        override fun onError(id: String?) {
          failed = true
          done.countDown()
        }

        override fun onError(id: String?, errorCode: Int) {
          failed = true
          done.countDown()
        }
      })

      val params = Bundle().apply {
        putString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, utteranceId)
      }
      if (tts.synthesizeToFile(text, params, target, utteranceId) != TextToSpeech.SUCCESS) {
        throw CodedException("${index + 1}번째 구간 합성을 시작하지 못했습니다.")
      }
      if (!done.await(3, TimeUnit.MINUTES) || failed || !target.exists()) {
        throw CodedException("${index + 1}번째 구간 합성에 실패했습니다.")
      }

      parts.add(AudioPart.Speech(target))

      sendEvent("onProgress", bundleOf("index" to index + 1, "total" to segments.size))

      // 줄바꿈·문단 구분을 실제 무음으로 살려 둔다. 안 그러면 여러 줄로 나눠 놓은
      // 조문이 이어 붙어 통째로 쭉 읽힌다.
      val seconds = when (segment.gap) {
        "para" -> PARAGRAPH_PAUSE_SEC
        "line" -> LINE_PAUSE_SEC
        "sentence" -> SENTENCE_PAUSE_SEC
        "clause" -> CLAUSE_PAUSE_SEC
        else -> 0.0
      }
      if (seconds > 0.0) parts.add(AudioPart.Silence(seconds))
    }

    return parts
  }

  // WAV 조각들을 이어 읽어 AAC 로 인코딩한다. WAV 대비 용량이 10분의 1 수준이 된다.
  private fun encodeToM4a(parts: List<AudioPart>, target: File) {
    val first = parts.firstNotNullOfOrNull { it as? AudioPart.Speech }
      ?: throw CodedException("합성된 음성이 없습니다.")
    val wav = WavInfo.read(first.file.readBytes())
    val channels = wav.channels
    val sampleRate = wav.sampleRate

    val format = MediaFormat.createAudioFormat(
      MediaFormat.MIMETYPE_AUDIO_AAC,
      sampleRate,
      channels
    ).apply {
      setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
      setInteger(MediaFormat.KEY_BIT_RATE, AAC_BITRATE * channels)
      setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 32768)
    }

    val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
    codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
    codec.start()

    val muxer = MediaMuxer(target.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    val info = MediaCodec.BufferInfo()
    val reader = PcmReader(parts, channels, sampleRate)
    val scratch = ByteArray(8192)

    var trackIndex = -1
    var muxing = false
    var inputDone = false
    var finished = false
    var samplesFed = 0L
    val bytesPerFrame = 2 * channels

    try {
      while (!finished) {
        if (!inputDone) {
          val inIndex = codec.dequeueInputBuffer(CODEC_TIMEOUT_US)
          if (inIndex >= 0) {
            val buffer = codec.getInputBuffer(inIndex)
            buffer?.clear()

            val limit = minOf(scratch.size, buffer?.capacity() ?: scratch.size)
            val read = reader.read(scratch, limit)
            val presentationUs = samplesFed * 1_000_000L / sampleRate

            if (read <= 0) {
              codec.queueInputBuffer(
                inIndex, 0, 0, presentationUs, MediaCodec.BUFFER_FLAG_END_OF_STREAM
              )
              inputDone = true
            } else {
              buffer?.put(scratch, 0, read)
              codec.queueInputBuffer(inIndex, 0, read, presentationUs, 0)
              samplesFed += read / bytesPerFrame
            }
          }
        }

        when (val outIndex = codec.dequeueOutputBuffer(info, CODEC_TIMEOUT_US)) {
          MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
            trackIndex = muxer.addTrack(codec.outputFormat)
            muxer.start()
            muxing = true
          }

          MediaCodec.INFO_TRY_AGAIN_LATER -> Unit

          else -> {
            if (outIndex >= 0) {
              val buffer = codec.getOutputBuffer(outIndex)

              if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) info.size = 0

              if (info.size > 0 && muxing && buffer != null) {
                buffer.position(info.offset)
                buffer.limit(info.offset + info.size)
                muxer.writeSampleData(trackIndex, buffer, info)
              }

              codec.releaseOutputBuffer(outIndex, false)
              if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) finished = true
            }
          }
        }
      }
    } finally {
      reader.close()
      runCatching { codec.stop() }
      codec.release()
      if (muxing) runCatching { muxer.stop() }
      muxer.release()
    }

    if (!target.exists() || target.length() <= 0) {
      throw CodedException("오디오 인코딩에 실패했습니다.")
    }
  }

  private fun copyToMusicFolder(source: File, displayName: String, relativePath: String): String {
    val resolver = context.contentResolver
    val values = ContentValues().apply {
      put(MediaStore.Audio.Media.DISPLAY_NAME, displayName)
      put(MediaStore.Audio.Media.MIME_TYPE, "audio/mp4")
      put(MediaStore.Audio.Media.RELATIVE_PATH, relativePath)
      put(MediaStore.Audio.Media.IS_PENDING, 1)
    }

    val uri = resolver.insert(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, values)
      ?: throw CodedException("저장할 파일을 만들지 못했습니다.")

    resolver.openOutputStream(uri).use { out ->
      out ?: throw CodedException("저장할 파일을 열지 못했습니다.")
      FileInputStream(source).use { it.copyTo(out) }
    }

    values.clear()
    values.put(MediaStore.Audio.Media.IS_PENDING, 0)
    resolver.update(uri, values, null, null)

    return uri.toString()
  }

  private fun queryLibrary(): List<Bundle> {
    val projection = arrayOf(
      MediaStore.Audio.Media._ID,
      MediaStore.Audio.Media.DISPLAY_NAME,
      MediaStore.Audio.Media.RELATIVE_PATH,
      MediaStore.Audio.Media.DURATION,
      MediaStore.Audio.Media.SIZE,
      MediaStore.Audio.Media.DATE_ADDED
    )

    val items = mutableListOf<Bundle>()

    context.contentResolver.query(
      MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
      projection,
      "${MediaStore.Audio.Media.RELATIVE_PATH} LIKE ?",
      arrayOf("$ROOT_FOLDER%"),
      "${MediaStore.Audio.Media.DATE_ADDED} DESC"
    )?.use { cursor ->
      val idCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
      val nameCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME)
      val pathCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.RELATIVE_PATH)
      val durationCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION)
      val sizeCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.SIZE)
      val addedCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DATE_ADDED)

      while (cursor.moveToNext()) {
        val id = cursor.getLong(idCol)
        val path = cursor.getString(pathCol) ?: ""

        // "Music/스텝바이/노동법/" -> "노동법", 루트면 빈 문자열
        val folder = path
          .trimEnd('/')
          .removePrefix(ROOT_FOLDER)
          .trim('/')

        items.add(
          bundleOf(
            "id" to id.toString(),
            "uri" to ContentUris.withAppendedId(
              MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id
            ).toString(),
            "name" to (cursor.getString(nameCol) ?: ""),
            "folder" to folder,
            "durationMs" to cursor.getLong(durationCol),
            "bytes" to cursor.getLong(sizeCol),
            "addedAt" to cursor.getLong(addedCol)
          )
        )
      }
    }

    return items
  }

  // 이어붙일 오디오 조각. 무음은 파일로 만들지 않고 읽을 때 바로 0 으로 채운다.
  sealed class AudioPart {
    class Speech(val file: File) : AudioPart()
    class Silence(val seconds: Double) : AudioPart()
  }

  // WAV 를 청크 단위로 읽는다. 헤더를 44바이트로 가정하면, 엔진이 LIST 같은 청크를
  // 덧붙인 파일에서 헤더 일부를 소리로 읽어 조각 머리마다 "틱" 하고 씹히는 소리가 난다.
  class WavInfo(
    val channels: Int,
    val sampleRate: Int,
    val bitsPerSample: Int,
    val dataOffset: Int,
    val dataSize: Int
  ) {
    companion object {
      fun read(bytes: ByteArray): WavInfo {
        fun le(offset: Int, size: Int): Int {
          var v = 0
          for (i in 0 until size) v = v or ((bytes[offset + i].toInt() and 0xFF) shl (8 * i))
          return v
        }
        fun id(offset: Int) = String(bytes, offset, 4, Charsets.US_ASCII)

        if (bytes.size < 12 || id(0) != "RIFF" || id(8) != "WAVE") {
          throw CodedException("엔진이 만든 오디오 형식을 읽지 못했습니다.")
        }

        var channels = 1
        var sampleRate = 0
        var bits = 16
        var pos = 12
        while (pos + 8 <= bytes.size) {
          val chunkId = id(pos)
          val size = le(pos + 4, 4)
          val body = pos + 8
          if (chunkId == "fmt ") {
            channels = le(body + 2, 2).coerceAtLeast(1)
            sampleRate = le(body + 4, 4)
            bits = le(body + 14, 2)
          } else if (chunkId == "data") {
            // 크기가 비었거나(스트리밍 중 기록) 파일보다 크면 파일 끝까지를 소리로 본다
            val available = bytes.size - body
            val dataSize = if (size <= 0 || size > available) available else size
            return WavInfo(channels, sampleRate.coerceAtLeast(8000), bits, body, dataSize)
          }
          pos = body + size + (size and 1) // 청크는 짝수 바이트로 정렬된다
        }
        throw CodedException("엔진이 만든 오디오에 소리 데이터가 없습니다.")
      }
    }
  }

  // 조각들을 하나의 PCM16 스트림처럼 읽는다.
  // 조각마다 실제 형식을 읽어 target(channels/sampleRate) 과 다르면 맞춰
  // 준다 — 짧은 조각에서 엔진이 다른 샘플레이트로 합성해 버리는 경우가 있는데,
  // 그걸 그냥 이어붙이면 그 구간만 엉뚱한 속도로 재생된다.
  private class PcmReader(
    private val parts: List<AudioPart>,
    private val targetChannels: Int,
    private val targetSampleRate: Int
  ) : Closeable {
    private var index = 0
    private var buffer: ByteArray? = null
    private var pos = 0

    fun read(dest: ByteArray, limit: Int): Int {
      while (true) {
        val buf = buffer
        if (buf == null) {
          if (index >= parts.size) return -1
          buffer = loadPart(parts[index++])
          pos = 0
          continue
        }
        if (pos >= buf.size) {
          buffer = null
          continue
        }
        val n = minOf(limit, buf.size - pos)
        System.arraycopy(buf, pos, dest, 0, n)
        pos += n
        return n
      }
    }

    private fun loadPart(part: AudioPart): ByteArray {
      if (part is AudioPart.Silence) {
        val frames = (targetSampleRate * part.seconds).toInt()
        return ByteArray(frames * 2 * targetChannels)
      }

      val bytes = (part as AudioPart.Speech).file.readBytes()
      val wav = WavInfo.read(bytes)
      var pcm = toPcm16(bytes, wav)

      if (wav.channels != targetChannels) {
        pcm = convertChannels(pcm, wav.channels, targetChannels)
      }
      if (wav.sampleRate != targetSampleRate) {
        pcm = resample(pcm, targetChannels, wav.sampleRate, targetSampleRate)
      }
      pcm = trimSilence(pcm, targetChannels, targetSampleRate)
      applyFade(pcm, targetChannels, targetSampleRate)
      return pcm
    }

    // 엔진은 보통 16비트로 주지만, 8비트·32비트 float 로 주는 엔진도 있다.
    // 형식을 안 따지고 그대로 이어붙이면 그 조각만 찢어지는 잡음이 된다.
    private fun toPcm16(bytes: ByteArray, wav: WavInfo): ByteArray {
      val start = wav.dataOffset
      val end = start + wav.dataSize
      return when (wav.bitsPerSample) {
        8 -> ByteArray((end - start) * 2).also { out ->
          for (i in start until end) {
            val v = ((bytes[i].toInt() and 0xFF) - 128) shl 8
            out[(i - start) * 2] = (v and 0xFF).toByte()
            out[(i - start) * 2 + 1] = ((v shr 8) and 0xFF).toByte()
          }
        }
        32 -> {
          val src = java.nio.ByteBuffer.wrap(bytes, start, end - start).order(java.nio.ByteOrder.LITTLE_ENDIAN)
          val count = (end - start) / 4
          val out = ByteArray(count * 2)
          val dst = java.nio.ByteBuffer.wrap(out).order(java.nio.ByteOrder.LITTLE_ENDIAN)
          for (i in 0 until count) {
            val f = src.getFloat(start + i * 4)
            dst.putShort(i * 2, (f * 32767f).toInt().coerceIn(-32768, 32767).toShort())
          }
          out
        }
        else -> bytes.copyOfRange(start, start + ((end - start) and 1.inv()))
      }
    }

    // 엔진이 조각 앞뒤에 붙이는 무음 길이는 조각마다 제각각이다. 그대로 이어붙이면
    // 어떤 줄은 바로 붙고 어떤 줄은 한참 쉬어 리듬이 들쭉날쭉해진다. 말소리 앞뒤로
    // 여유만 남기고 잘라 낸 뒤, 쉬는 길이는 우리가 넣는 무음으로 일정하게 맞춘다.
    private fun trimSilence(pcm: ByteArray, channels: Int, sampleRate: Int): ByteArray {
      val bytesPerFrame = 2 * channels
      val frames = pcm.size / bytesPerFrame
      if (frames == 0) return pcm
      val buf = java.nio.ByteBuffer.wrap(pcm).order(java.nio.ByteOrder.LITTLE_ENDIAN)

      fun loud(frame: Int): Boolean {
        for (c in 0 until channels) {
          if (kotlin.math.abs(buf.getShort((frame * channels + c) * 2).toInt()) > SPEECH_THRESHOLD) return true
        }
        return false
      }

      var first = 0
      while (first < frames && !loud(first)) first++
      if (first >= frames) return ByteArray(0) // 통째로 무음

      var last = frames - 1
      while (last > first && !loud(last)) last--

      val from = (first - sampleRate * KEEP_BEFORE_MS / 1000).coerceAtLeast(0)
      val to = (last + 1 + sampleRate * KEEP_AFTER_MS / 1000).coerceAtMost(frames)
      return pcm.copyOfRange(from * bytesPerFrame, to * bytesPerFrame)
    }

    // 잘라 낸 가장자리가 0 이 아닌 값에서 뚝 끊기면 "틱" 소리가 난다. 남겨 둔 여유
    // 구간(사실상 무음) 안에서만 아주 짧게 페이드시켜 말소리는 건드리지 않는다.
    private fun applyFade(pcm: ByteArray, channels: Int, sampleRate: Int) {
      if (channels <= 0 || sampleRate <= 0) return
      val bytesPerFrame = 2 * channels
      val totalFrames = pcm.size / bytesPerFrame
      val fadeFrames = (sampleRate * FADE_MS / 1000).coerceAtMost(totalFrames / 2)
      if (fadeFrames <= 0) return

      val buf = java.nio.ByteBuffer.wrap(pcm).order(java.nio.ByteOrder.LITTLE_ENDIAN)

      for (i in 0 until fadeFrames) {
        val gain = i.toDouble() / fadeFrames
        for (c in 0 until channels) {
          val idx = (i * channels + c) * 2
          val v = (buf.getShort(idx) * gain).toInt().coerceIn(-32768, 32767)
          buf.putShort(idx, v.toShort())
        }
      }
      for (i in 0 until fadeFrames) {
        val frameIdx = totalFrames - 1 - i
        val gain = i.toDouble() / fadeFrames
        for (c in 0 until channels) {
          val idx = (frameIdx * channels + c) * 2
          val v = (buf.getShort(idx) * gain).toInt().coerceIn(-32768, 32767)
          buf.putShort(idx, v.toShort())
        }
      }
    }

    private fun convertChannels(pcm: ByteArray, from: Int, to: Int): ByteArray {
      if (from == to || from <= 0 || to <= 0) return pcm
      val bIn = java.nio.ByteBuffer.wrap(pcm).order(java.nio.ByteOrder.LITTLE_ENDIAN)
      val samplesIn = pcm.size / 2 / from
      val out = ByteArray(samplesIn * to * 2)
      val bOut = java.nio.ByteBuffer.wrap(out).order(java.nio.ByteOrder.LITTLE_ENDIAN)

      for (s in 0 until samplesIn) {
        when {
          from == 1 && to == 2 -> {
            val v = bIn.getShort(s * 2)
            bOut.putShort(s * 4, v)
            bOut.putShort(s * 4 + 2, v)
          }
          from == 2 && to == 1 -> {
            val l = bIn.getShort(s * 4).toInt()
            val r = bIn.getShort(s * 4 + 2).toInt()
            bOut.putShort(s * 2, ((l + r) / 2).toShort())
          }
          else -> {
            // 3채널 이상 등 드문 경우 — 첫 채널만 대상 채널 수만큼 복제.
            val v = bIn.getShort(s * from * 2)
            for (c in 0 until to) bOut.putShort((s * to + c) * 2, v)
          }
        }
      }
      return out
    }

    // 짧은 문장에서 엔진이 다른 샘플레이트로 준 조각을 target 레이트로 맞춘다.
    // 선형 보간이라 완벽한 리샘플러는 아니지만, 짧은 조각 하나 맞추는 용도로는
    // 충분하다 — 목적은 "속도가 안 틀어지게" 지 음질 극대화가 아니다.
    private fun resample(pcm: ByteArray, channels: Int, fromRate: Int, toRate: Int): ByteArray {
      if (fromRate <= 0 || toRate <= 0 || fromRate == toRate) return pcm
      val bytesPerFrame = 2 * channels
      val framesIn = pcm.size / bytesPerFrame
      if (framesIn <= 1) return pcm

      val framesOut = (framesIn.toLong() * toRate / fromRate).toInt().coerceAtLeast(1)
      val bIn = java.nio.ByteBuffer.wrap(pcm).order(java.nio.ByteOrder.LITTLE_ENDIAN)
      val out = ByteArray(framesOut * bytesPerFrame)
      val bOut = java.nio.ByteBuffer.wrap(out).order(java.nio.ByteOrder.LITTLE_ENDIAN)

      for (i in 0 until framesOut) {
        val srcPos = i.toDouble() * fromRate / toRate
        val srcIndex = srcPos.toInt().coerceIn(0, framesIn - 1)
        val nextIndex = (srcIndex + 1).coerceAtMost(framesIn - 1)
        val frac = srcPos - srcIndex

        for (c in 0 until channels) {
          val s0 = bIn.getShort((srcIndex * channels + c) * 2).toInt()
          val s1 = bIn.getShort((nextIndex * channels + c) * 2).toInt()
          val v = (s0 + (s1 - s0) * frac).toInt().coerceIn(-32768, 32767)
          bOut.putShort((i * channels + c) * 2, v.toShort())
        }
      }
      return out
    }

    override fun close() {}
  }
}
