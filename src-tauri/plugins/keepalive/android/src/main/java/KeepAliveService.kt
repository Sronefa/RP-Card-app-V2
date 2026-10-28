package com.cardforge.keepalive

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat

/**
 * A foreground service that keeps the app's process, and so its WebView and model calls, alive
 * while a background job runs with the app minimized or the phone locked. It does no work itself.
 */
class KeepAliveService : Service() {
  companion object {
    private const val CHANNEL = "cardforge_background"
    private const val WORKING_ID = 4242
    private const val DONE_ID = 4243
    /** A job longer than this lets the phone sleep again. */
    private const val WAKE_LOCK_MS = 2L * 60 * 60 * 1000

    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"

    @Volatile
    var running = false
      private set

    private fun ensureChannel(context: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val manager = context.getSystemService(NotificationManager::class.java) ?: return
      if (manager.getNotificationChannel(CHANNEL) != null) return
      val channel = NotificationChannel(CHANNEL, "Background work", NotificationManager.IMPORTANCE_LOW)
      channel.description = "Shows while the UI engineer or another job keeps working in the background."
      manager.createNotificationChannel(channel)
    }

    private fun openApp(context: Context): PendingIntent? {
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
      launch.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
      return PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun build(context: Context, title: String?, text: String?, ongoing: Boolean): Notification {
      ensureChannel(context)
      return NotificationCompat.Builder(context, CHANNEL)
        .setSmallIcon(if (ongoing) android.R.drawable.stat_notify_sync else android.R.drawable.stat_notify_more)
        .setContentTitle(title?.takeIf { it.isNotBlank() } ?: "Engineer working")
        .setContentText(text ?: "")
        .setStyle(NotificationCompat.BigTextStyle().bigText(text ?: ""))
        .setContentIntent(openApp(context))
        .setOngoing(ongoing)
        .setAutoCancel(!ongoing)
        .setOnlyAlertOnce(true)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .build()
    }

    /** Changes the running notification's text. */
    fun update(context: Context, title: String?, text: String?) {
      if (!running) return
      context.getSystemService(NotificationManager::class.java)?.notify(WORKING_ID, build(context, title, text, true))
    }

    /** A dismissable notice that the work finished or needs the user. */
    fun notice(context: Context, title: String, text: String?) {
      context.getSystemService(NotificationManager::class.java)?.notify(DONE_ID, build(context, title, text, false))
    }
  }

  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val notification = build(this, intent?.getStringExtra(EXTRA_TITLE), intent?.getStringExtra(EXTRA_TEXT), true)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(WORKING_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(WORKING_ID, notification)
    }
    running = true
    if (wakeLock == null) {
      // Keeps the CPU awake for the model calls while the screen is off.
      wakeLock = (getSystemService(Context.POWER_SERVICE) as PowerManager)
        .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "CardForge:background")
        .apply {
          setReferenceCounted(false)
          acquire(WAKE_LOCK_MS)
        }
    }
    // If the system kills the app, the job is gone too: don't restart an empty service.
    return START_NOT_STICKY
  }

  /** Android 15 limits how long a data sync service may run; stop cleanly when told. */
  override fun onTimeout(startId: Int, fgsType: Int) {
    stopSelf()
  }

  override fun onDestroy() {
    running = false
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    super.onDestroy()
  }
}
