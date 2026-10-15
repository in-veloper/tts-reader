package expo.modules.playerwidget

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

private const val CHANNEL_ID = "stepby_widget_start"
private const val NOTIFICATION_ID = 4120
const val EXTRA_ACTION = "action"

// 앱이 완전히 꺼져 있을 때 위젯 버튼을 누르면 여기로 온다.
// 예전엔 앱 화면을 띄워서 재생시키려 했는데, 잠금화면·백그라운드에서 화면을 띄우는 건
// 안드로이드가 막아서 아무 일도 안 일어났다. 대신 화면 없이 JS 만 깨워서(헤드리스 작업)
// playback.js 의 resumeFromWidget 으로 마지막으로 듣던 곳부터 재생한다.
// 사용자가 위젯을 직접 누른 경우라 백그라운드에서 포그라운드 서비스를 시작하는 게 허용된다.
class WidgetPlaybackService : HeadlessJsTaskService() {

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    startInForeground()
    return super.onStartCommand(intent, flags, startId)
  }

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    val action = intent?.getStringExtra(EXTRA_ACTION) ?: "toggle"
    val data = Arguments.createMap().apply { putString("action", action) }
    return HeadlessJsTaskConfig("StepbyWidgetTask", data, 30_000, true)
  }

  override fun onHeadlessJsTaskFinish(taskId: Int) {
    // 재생이 시작되면 expo-audio 가 자기 재생 알림(잠금화면 컨트롤)을 띄우므로 이 임시 알림은 내린다.
    if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE) else @Suppress("DEPRECATION") stopForeground(true)
    super.onHeadlessJsTaskFinish(taskId)
  }

  // 포그라운드 서비스로 시작했으면 몇 초 안에 알림을 띄워야 한다 — 재생이 붙기 전까지 잠깐만 보인다.
  private fun startInForeground() {
    val builder = if (Build.VERSION.SDK_INT >= 26) {
      val nm = getSystemService(NotificationManager::class.java)
      nm.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "위젯에서 재생 시작", NotificationManager.IMPORTANCE_MIN)
      )
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION") Notification.Builder(this)
    }
    val notification = builder
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle("스텝바이")
      .setContentText("이어서 재생하는 중")
      .setOngoing(true)
      .build()

    if (Build.VERSION.SDK_INT >= 29) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }
}
