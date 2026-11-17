# FCM instancia el servicio por reflexión desde el manifiesto.
-keep class do.indrhi.emergencias.notifications.AlertMessagingService { *; }
-keep class do.indrhi.emergencias.notifications.AlertActionReceiver { *; }
# Payloads de alerta: no deben ofuscarse (contrato con el backend).
-keep class do.indrhi.emergencias.notifications.AlertPayload { *; }
