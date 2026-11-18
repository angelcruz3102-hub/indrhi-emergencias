package com.indrhi.emergencias.ui.webview

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.webkit.JavascriptInterface
import androidx.core.app.NotificationManagerCompat
import com.indrhi.emergencias.AppContainer
import com.indrhi.emergencias.BuildConfig
import com.indrhi.emergencias.IndrhiApp
import com.indrhi.emergencias.notifications.AlertChannels
import com.indrhi.emergencias.notifications.EmergencySirenPlayer
import com.indrhi.emergencias.presence.PresenceState
import com.indrhi.emergencias.presence.QrPayload
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

class NativeBridge(context: Context) {

    constructor(
        context: Context,
        @Suppress("UNUSED_PARAMETER") unusedContainer: AppContainer
    ) : this(context)

    private val appContext: Context = context.applicationContext
    private val container: AppContainer = (appContext as IndrhiApp).container
    private val sirenPlayer = EmergencySirenPlayer(appContext)

    @JavascriptInterface
    fun getContext(): String {
        val s = container.presenceStore.snapshot()
        val effective = container.presenceStore.effectiveState()
        return JSONObject().apply {
            put("building_code", s.buildingCode ?: JSONObject.NULL)
            put("presence_state", effective.name)
            put("presence_source", s.source.name)
            put("roles", JSONArray(container.currentRoleCodes()))
            put("last_entered_at", s.lastEnteredAt?.toString() ?: JSONObject.NULL)
            put("now", Instant.now().toString())
            put("app_version", BuildConfig.VERSION_NAME)
        }.toString()
    }

    @JavascriptInterface
    fun getHealth(): String {
        val nm = appContext.getSystemService(NotificationManager::class.java)
        val pm = appContext.getSystemService(PowerManager::class.java)

        return JSONObject().apply {
            put("notifications", NotificationManagerCompat.from(appContext).areNotificationsEnabled())
            put("dnd_access", AlertChannels.canBypassDnd(appContext))
            put(
                "full_screen",
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
                    nm?.canUseFullScreenIntent() == true
                else true
            )
            put(
                "battery",
                pm?.isIgnoringBatteryOptimizations(appContext.packageName) == true
            )
            put(
                "location",
                container.presenceStore.effectiveState() != PresenceState.DESCONOCIDA
            )
        }.toString()
    }

    @JavascriptInterface
    fun isPresenceKnown(): Boolean =
        container.presenceStore.effectiveState() != PresenceState.DESCONOCIDA

    @JavascriptInterface
    fun testAlarm() {
        sirenPlayer.start(looping = true)
    }

    @JavascriptInterface
    fun stopAlarm() {
        sirenPlayer.stop()
        container.alertNotifier.stopLastAlarm()
    }

    @JavascriptInterface
    fun isAlarmPlaying(): Boolean = sirenPlayer.isPlaying()

    @JavascriptInterface
    fun openNotificationSettings() {
        safeStart(
            Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, appContext.packageName)
        )
    }

    @JavascriptInterface
    fun openDndSettings() {
        safeStart(Intent(android.provider.Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS))
    }

    @JavascriptInterface
    fun openFullScreenSettings() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            safeStart(
                Intent(
                    android.provider.Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,
                    Uri.parse("package:${appContext.packageName}")
                )
            )
        } else {
            openNotificationSettings()
        }
    }

    @JavascriptInterface
    fun openBatterySettings() {
        safeStart(Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
    }

    @JavascriptInterface
    fun validateQr(rawJson: String): String {
        val payload = QrPayload.parse(rawJson)
            ?: return JSONObject().put("ok", false).put("reason", "INVALID_PAYLOAD").toString()
        return JSONObject().apply {
            put("ok", true)
            put("building_code", payload.buildingCode)
            put("code", payload.code)
        }.toString()
    }

    @JavascriptInterface
    fun getReentryState(): String {
        val state = container.reentryStateStore.state.value ?: return "null"
        return JSONObject().apply {
            put("building_code", state.buildingCode)
            put("status", state.status.name)
            put("had_evacuation", state.hadEvacuation)
            put("authorized_at", state.authorizedAt?.toString() ?: JSONObject.NULL)
            put("blocked_routes", JSONArray(state.blockedRoutes))
        }.toString()
    }

    private fun safeStart(intent: Intent) {
        try {
            appContext.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: Throwable) {
        }
    }
}
