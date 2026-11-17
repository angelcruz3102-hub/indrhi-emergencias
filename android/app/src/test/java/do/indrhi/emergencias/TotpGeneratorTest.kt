package do.indrhi.emergencias

import do.indrhi.emergencias.presence.TotpGenerator
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TotpGeneratorTest {

    // Vector RFC 6238 (SHA-256) — variante de 6 dígitos.
    private val secret = "12345678901234567890123456789012".toByteArray()

    @Test
    fun `genera 6 digitos`() {
        val code = TotpGenerator.generate(secret, 59_000L)
        assertEquals(6, code.length)
        assertTrue(code.all { it.isDigit() })
    }

    @Test
    fun `estable dentro del mismo periodo`() {
        val a = TotpGenerator.generate(secret, 45_000L)
        val b = TotpGenerator.generate(secret, 89_000L)
        assertEquals(a, b)
    }

    @Test
    fun `cambia entre periodos`() {
        val a = TotpGenerator.generate(secret, 0L)
        val b = TotpGenerator.generate(secret, 45_000L)
        assertTrue(a != b)
    }

    @Test
    fun `segundos restantes en rango`() {
        val s = TotpGenerator.secondsRemaining()
        assertTrue(s in 1..45)
    }
}
