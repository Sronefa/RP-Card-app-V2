package com.cardforge.keepalive

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg
class StatusArgs {
  var title: String? = null
  var text: String? = null
}

/** Starts and stops the background work service for the web app, and keeps its notification current. */
@TauriPlugin
class KeepAlivePlugin(private val activity: Activity) : Plugin(activity) {
  private var askedForNotifications = false

  /** Android 13 and up need the user's yes to show the notification; the service runs either way. */
  private fun askForNotifications() {
    if (askedForNotifications || Build.VERSION.SDK_INT < 33) return
    askedForNotifications = true
    val permission = "android.permission.POST_NOTIFICATIONS"
    if (ContextCompat.checkSelfPermission(activity, permission) != PackageManager.PERMISSION_GRANTED) {
      ActivityCompat.requestPermissions(activity, arrayOf(permission), 4244)
    }
  }

  @Command
  fun start(invoke: Invoke) {
    val args = invoke.parseArgs(StatusArgs::class.java)
    askForNotifications()
    if (KeepAliveService.running) {
      KeepAliveService.update(activity, args.title, args.text)
      invoke.resolve()
      return
    }
    val intent = Intent(activity, KeepAliveService::class.java)
      .putExtra(KeepAliveService.EXTRA_TITLE, args.title)
      .putExtra(KeepAliveService.EXTRA_TEXT, args.text)
    try {
      ContextCompat.startForegroundService(activity, intent)
      invoke.resolve()
    } catch (e: Exception) {
      // Android won't start one from the background; the job still runs while the app is open.
      invoke.reject(e.message ?: "Couldn't start the background service")
    }
  }

  @Command
  fun update(invoke: Invoke) {
    val args = invoke.parseArgs(StatusArgs::class.java)
    KeepAliveService.update(activity, args.title, args.text)
    invoke.resolve()
  }

  @Command
  fun stop(invoke: Invoke) {
    val args = invoke.parseArgs(StatusArgs::class.java)
    activity.stopService(Intent(activity, KeepAliveService::class.java))
    args.title?.takeIf { it.isNotBlank() }?.let { KeepAliveService.notice(activity, it, args.text) }
    invoke.resolve()
  }
}
