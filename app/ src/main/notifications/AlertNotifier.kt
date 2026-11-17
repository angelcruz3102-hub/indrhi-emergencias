package do.indrhi.emergencias.notifications

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import do.indrhi.emergencias.R
import do.indrhi.emergencias.presence.PresenceState
import do.indrhi.emergencias.presence.PresenceStore
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

/**
 * Único punto de publicación de notificaciones de alerta.
 * No hace red, no toca GPS: solo construye y publica.
 */
class AlertNotifier(
    private val context: Context,
    private val presenceStore: PresenceStore,
) {

    private val nm = NotificationManagerCompat.from(context)

    fun deliver(payload: AlertPayload): DeliveryOutcome {
        if (!notificationsAllowed()) {
            Log.w(TAG, "Sistema bloquea notificaciones; alerta ${payload.alertId} no publicada")
            return DeliveryOutcome.SISTEMA_BLOQUEADO
        }
        if (!isInScope(payload)) {
            Log.i(TAG, "Alerta ${payload.alertId} (${payload.severity}) diferida: dispositivo fuera del recinto")
            return DeliveryOutcome.FUERA_DE_ALCANCE
        }

        AlertChannels.ensure(context)

        return try {
            nm.notify(payload.notificationId, build(payload))
            DeliveryOutcome.ENTREGADA
        } catch (t: Throwable) {
            Log.e(TAG, "No fue posible publicar la alerta ${payload.alertId}", t)
            DeliveryOutcome.ERROR
        }
    }

    /** Cancela la alerta y todos sus pasos de escalamiento (0..9). */
    fun cancel(alertId: String) {
        for (step in 0..9) nm.cancel(AlertPayload.notificationIdFor(alertId, step))
        AlertAckRegistry.clear(alertId)
    }

    /** Botón "Probar Alarma" de la pantalla de salud de entrega. */
    fun notifyTest(): DeliveryOutcome {
        val payload = AlertPayload(
            alertId = "test-${System.currentTimeMillis()}",
            severity = Severity.ROJO,
            level = 1,
            title = context.getString(R.string.test_alert_title),
            message = context.getString(R.string.test_alert_message),
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

    // ---------------------------------------------------------------- interno

    private fun isInScope(payload: AlertPayload): Boolean {
        // ROJO y AMARILLO fallan ABIERTO: si la presencia es DESCONOCIDA o el
        // equipo está fuera de turno dentro del recinto, se muestran igual.
        if (payload.severity != Severity.VERDE) return true

        // VERDE: si sabemos con certeza que el dispositivo está fuera del recinto,
        // se difiere. La reprogramación real la hace el servidor (defer_until_shift).
        return presenceStore.effectiveState() != PresenceState.FUERA
    }

    private fun notificationsAllowed(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(
                context, Manifest.permission.POST_NOTIFICATIONS
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            return false
        }
        return nm.areNotificationsEnabled()
    }

    private fun build(payload: AlertPayload): Notification {
        val isRed = payload.severity == Severity.ROJO
        val openIntent = PendingIntent.getActivity(
            context,
            payload.notificationId,
            FullScreenAlertActivity.newIntent(context, payload),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val builder = NotificationCompat.Builder(context, payload.channelId)
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
            .setSubText(context.getString(R.string.app_short_name))
            .setWhen(payload.sentAtEpochMs)
            .setShowWhen(true)
            .setOnlyAlertOnce(false)
            .setAutoCancel(!payload.requiresAck)
            .setOngoing(payload.requiresAck)
            .setContentIntent(openIntent)

        // El canal gobierna sonido/vibración; aquí solo se evita el doble pitido.
        builder.setDefaults(0)

        if (payload.severity != Severity.VERDE) {
            builder.setFullScreenIntent(openIntent, true)
        }

        if (payload.requiresAck) {
            builder.addAction(
                0,
                context.getString(R.string.action_ack),
                ackPendingIntent(payload),
            )
        }

        if (payload.isDrill) {
            builder.setTicker(context.getString(R.string.drill_badge))
        }

        if (payload.severity == Severity.VERDE) {
            // Aviso informativo: se autodescarta para no acumular ruido operativo.
            builder.setTimeoutAfter(30 * 60 * 1000L)
        }

        return builder.build()
    }

    private fun ackPendingIntent(payload: AlertPayload): PendingIntent =
        PendingIntent.getBroadcast(
            context,
            payload.notificationId,
            AlertActionReceiver.ackIntent(context, payload),
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

/**
 * Registro en memoria de acuses (mismo proceso). Permite que la pantalla completa
 * se cierre cuando el usuario acusa desde la propia notificación.
 */
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
