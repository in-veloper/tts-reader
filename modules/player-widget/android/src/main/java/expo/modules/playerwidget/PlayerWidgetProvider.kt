package expo.modules.playerwidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.view.View
import android.widget.RemoteViews

private const val ACTION_TOGGLE = "expo.modules.playerwidget.ACTION_TOGGLE"
private const val ACTION_NEXT = "expo.modules.playerwidget.ACTION_NEXT"
private const val ACTION_PREVIOUS = "expo.modules.playerwidget.ACTION_PREVIOUS"
private const val ACTION_REPEAT = "expo.modules.playerwidget.ACTION_REPEAT"

// "지금 재생 중인 게 뭔지" 는 JS(playback.js)의 메모리에만 있다 — memento/
// 오토커넥트 위젯과 달리 네이티브가 직접 읽을 수 있는 저장소가 없다. 그래서
// PlayerWidgetModule.update() 가 부를 때마다 여기 저장해 두고, 위젯은 그
// "마지막으로 들은 내용" 을 보여준다. 앱이 완전히 꺼진 뒤에도 마지막 상태가
// 남아 있는 게, 매번 텅 비어 보이는 것보다 낫다.
private const val PREFS = "player_widget"
private const val KEY_TITLE = "title"
private const val KEY_SUBTITLE = "subtitle"
private const val KEY_PLAYING = "playing"
private const val KEY_REPEAT = "repeat"

class PlayerWidgetProvider : AppWidgetProvider() {

  override fun onUpdate(context: Context, mgr: AppWidgetManager, appWidgetIds: IntArray) {
    appWidgetIds.forEach { render(context, mgr, it) }
  }

  // 버튼 탭이 여기로 들어온다. 앱(JS)이 살아 있으면(백그라운드 재생 중이면
  // 반드시 살아 있다) PlayerWidgetModule 이 이벤트를 playback.js 로 넘겨서
  // 실제로 처리한다 — 여기서는 명령을 전달만 하고, 결과는 playback.js 가
  // update() 를 다시 불러서 보여준다.
  //
  // 앱이 완전히 꺼져 있어 이벤트를 받을 JS 가 없으면(dispatch 가 false) 딥링크로
  // 앱을 연다 — App.js 가 그 링크를 보고 마지막으로 듣던 걸 알아서 이어 튼다
  // (playback.js 의 resumeFromWidget). 잠금화면에서 곧장 재생을 켤 수 있는
  // 유일한 방법이 이거다.
  override fun onReceive(context: Context, intent: Intent) {
    super.onReceive(context, intent)

    val action = when (intent.action) {
      ACTION_TOGGLE -> "toggle"
      ACTION_NEXT -> "next"
      ACTION_PREVIOUS -> "previous"
      ACTION_REPEAT -> "repeat"
      else -> return
    }

    // 재생/일시정지는 눌렀을 때 바로 아이콘을 바꿔서 반응이 느려 보이지
    // 않게 한다. 실제 상태는 JS 가 처리한 뒤 update() 로 다시 확정해 준다.
    if (action == "toggle") {
      val prefs = prefs(context)
      val wasPlaying = prefs.getBoolean(KEY_PLAYING, false)
      prefs.edit().putBoolean(KEY_PLAYING, !wasPlaying).apply()
      refreshAll(context)
    }

    val delivered = PlayerWidgetModule.dispatch(action)
    if (!delivered) {
      val openApp = Intent(Intent.ACTION_VIEW, android.net.Uri.parse("stepby://widget?action=$action")).apply {
        setPackage(context.packageName)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      context.startActivity(openApp)
    }
  }

  companion object {
    private fun prefs(context: Context): SharedPreferences =
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun save(context: Context, title: String?, subtitle: String?, playing: Boolean, repeat: String?) {
      prefs(context).edit()
        .putString(KEY_TITLE, title)
        .putString(KEY_SUBTITLE, subtitle)
        .putBoolean(KEY_PLAYING, playing)
        .putString(KEY_REPEAT, repeat ?: "none")
        .apply()
    }

    fun refreshAll(context: Context) {
      val mgr = AppWidgetManager.getInstance(context)
      val ids = mgr.getAppWidgetIds(ComponentName(context, PlayerWidgetProvider::class.java))
      ids.forEach { render(context, mgr, it) }
    }

    private fun render(context: Context, mgr: AppWidgetManager, appWidgetId: Int) {
      val views = RemoteViews(context.packageName, R.layout.player_widget)

      val openApp = context.packageManager.getLaunchIntentForPackage(context.packageName)
      val openAppPending = openApp?.let {
        PendingIntent.getActivity(
          context, 0, it,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
      }
      openAppPending?.let { views.setOnClickPendingIntent(R.id.widget_label, it) }

      val p = prefs(context)
      val title = p.getString(KEY_TITLE, null)
      val subtitle = p.getString(KEY_SUBTITLE, null)
      val playing = p.getBoolean(KEY_PLAYING, false)
      val repeat = p.getString(KEY_REPEAT, "none") ?: "none"

      views.setImageViewResource(
        R.id.btn_repeat,
        if (repeat == "none") R.drawable.player_widget_repeat_off else R.drawable.player_widget_repeat_on
      )
      views.setInt(
        R.id.btn_repeat,
        "setBackgroundResource",
        if (repeat == "none") R.drawable.player_widget_ghost_bg else R.drawable.player_widget_repeat_active_bg
      )
      views.setViewVisibility(R.id.repeat_badge, if (repeat == "single") View.VISIBLE else View.GONE)
      views.setOnClickPendingIntent(R.id.btn_repeat, actionPendingIntent(context, ACTION_REPEAT, 4))

      if (title.isNullOrBlank()) {
        views.setViewVisibility(R.id.widget_content, View.GONE)
        views.setViewVisibility(R.id.widget_empty, View.VISIBLE)
        openAppPending?.let { views.setOnClickPendingIntent(R.id.widget_empty, it) }
      } else {
        views.setViewVisibility(R.id.widget_content, View.VISIBLE)
        views.setViewVisibility(R.id.widget_empty, View.GONE)

        views.setTextViewText(R.id.widget_title, title)
        if (subtitle.isNullOrBlank()) {
          views.setViewVisibility(R.id.widget_subtitle, View.GONE)
        } else {
          views.setViewVisibility(R.id.widget_subtitle, View.VISIBLE)
          views.setTextViewText(R.id.widget_subtitle, subtitle)
        }

        views.setImageViewResource(
          R.id.btn_toggle,
          if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play
        )

        views.setOnClickPendingIntent(R.id.btn_toggle, actionPendingIntent(context, ACTION_TOGGLE, 1))
        views.setOnClickPendingIntent(R.id.btn_previous, actionPendingIntent(context, ACTION_PREVIOUS, 2))
        views.setOnClickPendingIntent(R.id.btn_next, actionPendingIntent(context, ACTION_NEXT, 3))
      }

      mgr.updateAppWidget(appWidgetId, views)
    }

    private fun actionPendingIntent(context: Context, action: String, requestCode: Int): PendingIntent {
      val intent = Intent(context, PlayerWidgetProvider::class.java).apply { this.action = action }
      return PendingIntent.getBroadcast(
        context,
        requestCode,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
    }
  }
}
