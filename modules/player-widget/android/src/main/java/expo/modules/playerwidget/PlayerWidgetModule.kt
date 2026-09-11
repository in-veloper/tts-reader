package expo.modules.playerwidget

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// playback.js 와 위젯 사이를 잇는다.
//
// update(): playback.js 가 재생 상태(제목/폴더/재생 여부)가 바뀔 때마다 불러서
// 위젯에 그대로 반영한다 — 위젯은 스스로 "뭐가 재생 중인지" 알 방법이 없다.
//
// dispatch(): 위젯 버튼을 눌렀을 때 PlayerWidgetProvider 가 여기로 들어와서
// onWidgetAction 이벤트를 쏜다. playback.js 가 그 이벤트를 듣고 togglePlay
// /next/previous 를 그대로 부른다. 이 모듈 인스턴스가 아직 없으면(=JS 가 안
// 떠 있으면) false 를 돌려주고, 리시버 쪽에서 대신 앱을 연다.
class PlayerWidgetModule : Module() {
  init {
    current = this
  }

  override fun definition() = ModuleDefinition {
    Name("PlayerWidget")
    Events("onWidgetAction")

    OnDestroy {
      if (current === this@PlayerWidgetModule) current = null
    }

    Function("update") { title: String?, subtitle: String?, playing: Boolean, repeat: String? ->
      val context = appContext.reactContext ?: throw CodedException("앱 컨텍스트를 찾을 수 없습니다.")
      PlayerWidgetProvider.save(context, title, subtitle, playing, repeat)
      PlayerWidgetProvider.refreshAll(context)
    }
  }

  fun dispatchEvent(action: String) {
    sendEvent("onWidgetAction", mapOf("action" to action))
  }

  companion object {
    @Volatile
    private var current: PlayerWidgetModule? = null

    fun dispatch(action: String): Boolean {
      val mod = current ?: return false
      mod.dispatchEvent(action)
      return true
    }
  }
}
