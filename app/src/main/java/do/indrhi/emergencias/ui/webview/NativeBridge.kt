package do.indrhi.emergencias.ui.webview

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.webkit.JavascriptInterface
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import do.indrhi.emergencias.BuildConfig
import do.indrhi.emergencias.R
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

class NativeBridge(private val context: Context) {

    @JavascriptInterface
    fun getContext(): String {
        val hasFine = ContextCompat.checkSelfPermission(
            context, Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

        return JSONObject().apply {
            put("building_code", JSONObject.NULL)
            put("presence_state", if (hasFine) "DENTRO" else "DESCONOCIDA")
            put("presence_source", "GEOFENCE")
            put("roles", JSONArray())
            put("last_entered_at", JSONObject.NULL)
            put("now", Instant.now().toString())
            put("app_version", BuildConfig.VERSION_NAME)
        }.toString()
    }

    @JavascriptInterface
    fun getHealth(): String {
        val ctx = context.applicationContext
        val nm = ctx.getSystemService(NotificationManager::class.java)
        val pm = ctx.getSystemService(PowerManager::class.java)
        val hasLocation = ContextCompat.checkSelfPermission(
            ctx, Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

        return JSONObject().apply {
            put("notifications", NotificationManagerCompat.from(ctx).areNotificationsEnabled())
            put("dnd_access", nm?.isNotificationPolicyAccessGranted == true)
            put(
                "full_screen",
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
                    nm?.canUseFullScreenIntent() == true
                else true
            )
            put("battery", pm?.isIgnoringBatteryOptimizations(ctx.packageName) == true)
            put("location", hasLocation)
        }.toString()
    }

    @JavascriptInterface
    fun isPresenceKnown(): Boolean =
        ContextCompat.checkSelfPermission(
            context, Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

    @JavascriptInterface
    fun testAlarm() {
        val ctx = context.applicationContext
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) return

        val alarmUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)

        val notification = NotificationCompat.Builder(ctx, "alerta_roja")
            .setSmallIcon(R.drawable.ic_stat_alert)
            .setContentTitle("PRUEBA · ALERTA ROJA INDRHI")
            .setContentText("Verificación de canal de emergencia, sonido y vibración.")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setSound(alarmUri)
            .setVibrate(longArrayOf(0, 800, 300, 800, 300, 800))
            .setAutoCancel(true)
            .build()

        NotificationManagerCompat.from(ctx).notify(9901, notification)
    }

    @JavascriptInterface
    fun openNotificationSettings() {
        val i = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(i)
    }

    @JavascriptInterface
    fun openDndSettings() {
        val i = Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(i)
    }

    @JavascriptInterface
    fun openFullScreenSettings() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            val i = Intent(
                Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,
                Uri.parse("package:${context.packageName}")
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(i)
        } else {
            openNotificationSettings()
        }
    }

    @JavascriptInterface
    fun openBatterySettings() {
        val i = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(i)
    }

    @JavascriptInterface
    fun getReentryState(): String = "null"
}
