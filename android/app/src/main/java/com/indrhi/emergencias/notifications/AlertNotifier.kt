package com.indrhi.emergencias.notifications

import android.Manifest
import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.indrhi.emergencias.R
import com.indrhi.emergencias.presence.PresenceState
import com.indrhi.emergencias.presence.PresenceStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

enum class DeliveryOutcome {
    ENTREGADA,
    FUERA_DE_ALCANCE,
    SISTEMA_BLOQUEADO,
    ERROR,
}

class AlertNotifier(
    context: Context,
    private val presenceStore: PresenceStore,
) {

    private val appContext: Context = context.applicationContext
    private val nm = NotificationManagerCompat.from(appContext)

    @Volatile
    private var lastAlertId: String? = null

    fun deliver(payload: AlertPayload): DeliveryOutcome {
        if (!notificationsAllowed()) {
            Log.w(TAG, "Notificaciones bloqueadas; ${payload.alertId} no publicada")
            return DeliveryOutcome.SISTEMA_BLOQUEADO
        }
        if (!isInScope(payload)) {
            Log.i(TAG, "Alerta ${payload.alertId} diferida: fuera de alcance")
            return DeliveryOutcome.FUERA_DE_ALCANCE
        }

        AlertChannels.ensure(appContext)
        lastAlertId = payload.alertId

        return try {
            nm.notify(payload.notificationId, build(payload))
            DeliveryOutcome.ENTREGADA
        } catch (t: Throwable) {
            Log.e(TAG, "No se pudo publicar ${payload.alertId}", t)
            DeliveryOutcome.ERROR
        }
    }

    fun cancel(alertId: String) {
        for (step in 0..9) nm.cancel(AlertPayload.notificationIdFor(alertId, step))
        AlertAckRegistry.clear(alertId)
    }

    fun stopLastAlarm() {
        val id = lastAlertId ?: return
        AlertAckRegistry.markAcked(id)
        cancel(id)
        lastAlertId = null
    }

    fun notifyTest(): DeliveryOutcome {
        val payload = AlertPayload(
            alertId = "test-${System.currentTimeMillis()}",
            severity = Severity.ROJO,
            level = 1,
            title = appContext.getString(R.string.test_alert_title),
            message = appContext.getString(R.string.test_alert_message),
            incidentId = null,
            buildingCode = "ED1",
            isDrill = true,
            requiresAck = false,
            ackDeadlineSeconds = 60,
            escalationStep = 0,
            sentAtEpochMs = System.currentTimeMillis(),
            channelId = AlertChannels.RED,
        )
        return deliver(payload)
    }

    private fun isInScope(payload: AlertPayload): Boolean {
        if (payload.severity != Severity.VERDE) return true
        return presenceStore.effectiveState() != PresenceState.FUERA
    }

    private fun notificationsAllowed(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(
                appContext, Manifest.permission.POST_NOTIFICATIONS
            ) != PackageManager.PERMISSION_GRANTED
        ) return false
        return nm.areNotificationsEnabled()
    }

    private fun build(payload: AlertPayload): Notification {
        val isRed = payload.severity == Severity.ROJO
        val openIntent = PendingIntent.getActivity(
            appContext,
            payload.notificationId,
            FullScreenAlertActivity.newIntent(appContext, payload),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val builder = NotificationCompat.Builder(appContext, payload.channelId)
            .setSmallIcon(R.drawable.ic_stat_alert)
            .setContentTitle(payload.title)
            .setContentText(payload.message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(payload.message))
            .setPriority(priorityOf(payload.severity))
            .setCategory(
                if (isRed) NotificationCompat.CATEGORY_ALARM
                else NotificationCompat.CATEGORY_STATUS
            )
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setGroup(AlertChannels.GROUP_KEY)
            .setColor(colorOf(payload.severity))
            .setSubText(appContext.getString(R.string.app_short_name))
            .setWhen(payload.sentAtEpochMs)
            .setShowWhen(true)
            .setOnlyAlertOnce(false)
            .setAutoCancel(!payload.requiresAck)
            .setOngoing(payload.requiresAck)
            .setContentIntent(openIntent)
            .setDefaults(0)

        if (payload.severity != Severity.VERDE) {
            builder.setFullScreenIntent(openIntent, true)
        }

        if (payload.requiresAck) {
            builder.addAction(0, appContext.getString(R.string.action_ack), ackPendingIntent(payload))
        }

        if (payload.isDrill) {
            builder.setTicker(appContext.getString(R.string.drill_badge))
        }

        if (payload.severity == Severity.VERDE) {
            builder.setTimeoutAfter(30 * 60 * 1000L)
        }

        return builder.build()
    }

    private fun ackPendingIntent(payload: AlertPayload): PendingIntent =
        PendingIntent.getBroadcast(
            appContext,
            payload.notificationId,
            AlertActionReceiver.ackIntent(appContext, payload),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    private fun priorityOf(severity: Severity): Int = when (severity) {
        Severity.ROJO -> NotificationCompat.PRIORITY_MAX
        Severity.AMARILLO -> NotificationCompat.PRIORITY_HIGH
        Severity.VERDE -> NotificationCompat.PRIORITY_DEFAULT
    }

    private fun colorOf(severity: Severity): Int = when (severity) {
        Severity.ROJO -> 0xFFD32F2F.toInt()
        Severity.AMARILLO -> 0xFFF9A825.toInt()
        Severity.VERDE -> 0xFF388E3C.toInt()
    }

    companion object {
        private const val TAG = "AlertNotifier"
    }
}

object AlertAckRegistry {

    private val _acked = MutableStateFlow<Set<String>>(emptySet())
    val acked: StateFlow<Set<String>> = _acked.asStateFlow()

    fun markAcked(alertId: String) {
        _acked.update { it + alertId }
    }

    fun clear(alertId: String) {
        _acked.update { it - alertId }
    }

    fun isAcked(alertId: String): Boolean = _acked.value.contains(alertId)
}
