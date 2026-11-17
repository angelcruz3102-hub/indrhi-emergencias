package do.indrhi.emergencias.notifications

import android.content.Intent
import android.os.Bundle
import androidx.annotation.Keep

/** Semáforo de severidad (eje independiente del alcance 1/2/3). */
enum class Severity {
    ROJO, AMARILLO, VERDE;

    val requiresAck: Boolean get() = this == ROJO || this == AMARILLO

    companion object {
        fun fromRaw(raw: String?): Severity? =
            entries.firstOrNull { it.name.equals(raw?.trim(), ignoreCase = true) }
    }
}

/**
 * Contrato del data-message FCM. TODO el texto viaja en el push:
 * la ruta que hace sonar el teléfono no consulta red ni GPS.
 *
 * Keys en minúsculas y estables — el backend las emite tal cual (RF-1.1..1.9, RF-4.1..4.5).
 */
@Keep
data class AlertPayload(
    val alertId: String,
    val severity: Severity,
    val level: Int,
    val title: String,
    val message: String,
    val incidentId: String?,
    val buildingCode: String?,
    val isDrill: Boolean,
    val requiresAck: Boolean,
    val ackDeadlineSeconds: Int,
    val escalationStep: Int,
    val sentAtEpochMs: Long,
    val channelId: String,
) {
    val notificationId: Int get() = notificationIdFor(alertId, escalationStep)

    fun toMap(): Map<String, String> = mapOf(
        K_ALERT_ID to alertId,
        K_SEVERITY to severity.name,
        K_LEVEL to level.toString(),
        K_TITLE to title,
        K_MESSAGE to message,
        K_INCIDENT_ID to (incidentId ?: ""),
        K_BUILDING to (buildingCode ?: ""),
        K_IS_DRILL to if (isDrill) "1" else "0",
        K_REQUIRES_ACK to if (requiresAck) "1" else "0",
        K_ACK_DEADLINE to ackDeadlineSeconds.toString(),
        K_ESCALATION_STEP to escalationStep.toString(),
        K_SENT_AT to sentAtEpochMs.toString(),
        K_CHANNEL to channelId,
    )

    fun toBundle(): Bundle = Bundle().apply {
        toMap().forEach { (k, v) -> putString(k, v) }
    }

    companion object {
        const val K_ALERT_ID = "alert_id"
        const val K_SEVERITY = "severity"
        const val K_LEVEL = "level"
        const val K_TITLE = "title"
        const val K_MESSAGE = "message"
        const val K_INCIDENT_ID = "incident_id"
        const val K_BUILDING = "building_code"
        const val K_IS_DRILL = "is_drill"
        const val K_REQUIRES_ACK = "requires_ack"
        const val K_ACK_DEADLINE = "ack_deadline_s"
        const val K_ESCALATION_STEP = "escalation_step"
        const val K_SENT_AT = "sent_at_ms"
        const val K_CHANNEL = "channel"

        private const val MAX_ESCALATION_STEPS = 9

        fun notificationIdFor(alertId: String, step: Int): Int =
            ("$alertId#$step").hashCode() and 0x7fffffff

        /**
         * Devuelve null si el mensaje no es una alerta válida.
         * Un mensaje inválido NUNCA debe sonar: es preferible no molestar
         * que educar al usuario a ignorar el canal rojo.
         */
        fun from(data: Map<String, String>): AlertPayload? {
            val alertId = data[K_ALERT_ID]?.trim().orEmpty()
            val message = data[K_MESSAGE]?.trim().orEmpty()
            val severity = Severity.fromRaw(data[K_SEVERITY]) ?: return null
            if (alertId.isEmpty() || message.isEmpty()) return null

            val buildingCode = data[K_BUILDING]?.trim()?.takeIf { it.isNotEmpty() }
            val isDrill = data[K_IS_DRILL].asBool()
            val requiresAck = data[K_REQUIRES_ACK]?.let { it.asBool() } ?: severity.requiresAck

            return AlertPayload(
                alertId = alertId,
                severity = severity,
                level = (data[K_LEVEL]?.toIntOrNull() ?: 1).coerceIn(1, 3),
                title = data[K_TITLE]?.trim()?.takeIf { it.isNotEmpty() }
                    ?: defaultTitle(severity, buildingCode, isDrill),
                message = message,
                incidentId = data[K_INCIDENT_ID]?.trim()?.takeIf { it.isNotEmpty() },
                buildingCode = buildingCode,
                isDrill = isDrill,
                requiresAck = requiresAck,
                ackDeadlineSeconds = (data[K_ACK_DEADLINE]?.toIntOrNull() ?: 60).coerceIn(30, 600),
                escalationStep = (data[K_ESCALATION_STEP]?.toIntOrNull() ?: 0)
                    .coerceIn(0, MAX_ESCALATION_STEPS),
                sentAtEpochMs = data[K_SENT_AT]?.toLongOrNull() ?: System.currentTimeMillis(),
                channelId = data[K_CHANNEL]?.trim()?.takeIf { it.isNotEmpty() }
                    ?: defaultChannel(severity),
            )
        }

        fun fromIntent(intent: Intent?): AlertPayload? {
            val extras = intent?.extras ?: return null
            val map = extras.keySet().associateWith { key -> extras.getString(key).orEmpty() }
            return from(map)
        }

        private fun defaultChannel(severity: Severity): String = when (severity) {
            Severity.ROJO -> AlertChannels.RED
            Severity.AMARILLO -> AlertChannels.YELLOW
            Severity.VERDE -> AlertChannels.GREEN
        }

        private fun defaultTitle(
            severity: Severity,
            buildingCode: String?,
            drill: Boolean,
        ): String = buildString {
            append(
                when (severity) {
                    Severity.ROJO -> "ALERTA ROJA"
                    Severity.AMARILLO -> "ALERTA AMARILLA"
                    Severity.VERDE -> "AVISO"
                }
            )
            buildingCode?.let { append(" · ").append(it) }
            if (drill) append(" · SIMULACRO")
        }

        private fun String?.asBool(): Boolean {
            val v = this?.trim()?.lowercase() ?: return false
            return v == "1" || v == "true" || v == "yes" || v == "si" || v == "sí"
        }
    }
}
