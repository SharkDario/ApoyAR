package expo.modules.apoyarnativo

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.SecureRandom
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.security.spec.MGF1ParameterSpec
import java.security.spec.X509EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource

/**
 * Claves que nunca salen del hardware seguro del teléfono:
 *  - Par EC P-256 con atestación para firmar el hash de cada evidencia.
 *  - Clave maestra AES-256 que envuelve las DEK de cada archivo.
 * Se usa StrongBox cuando existe y, si no, el TEE del procesador.
 */
object ClavesHardware {
  private const val PROVEEDOR = "AndroidKeyStore"
  private const val ALIAS_FIRMA = "apoyar_firma_evidencia_v1"
  private const val ALIAS_MAESTRA = "apoyar_clave_maestra_v1"
  private const val BYTES_IV_GCM = 12
  private const val BITS_TAG_GCM = 128

  private val almacen: KeyStore
    get() = KeyStore.getInstance(PROVEEDOR).apply { load(null) }

  fun firmarHash(hashHex: String): String {
    val firmante = Signature.getInstance("SHA256withECDSA")
    firmante.initSign(clavePrivadaFirma())
    firmante.update(hexABytes(hashHex))
    return base64(firmante.sign())
  }

  fun obtenerDatosFirma(): Map<String, Any> {
    val clave = clavePrivadaFirma()
    return mapOf(
      "algoritmo" to "SHA256withECDSA",
      "nivel" to nivelDeSeguridad(clave),
      "cadena_certificados_b64" to almacen.getCertificateChain(ALIAS_FIRMA).map { base64(it.encoded) },
    )
  }

  fun envolverDekDispositivo(dekHex: String): String {
    val cifrador = Cipher.getInstance("AES/GCM/NoPadding")
    cifrador.init(Cipher.ENCRYPT_MODE, claveMaestra())
    return base64(cifrador.iv + cifrador.doFinal(hexABytes(dekHex)))
  }

  fun desenvolverDekDispositivo(envuelta: String): String {
    val datos = Base64.decode(envuelta, Base64.NO_WRAP)
    val cifrador = Cipher.getInstance("AES/GCM/NoPadding")
    cifrador.init(
      Cipher.DECRYPT_MODE,
      claveMaestra(),
      GCMParameterSpec(BITS_TAG_GCM, datos, 0, BYTES_IV_GCM),
    )
    return bytesAHex(cifrador.doFinal(datos, BYTES_IV_GCM, datos.size - BYTES_IV_GCM))
  }

  /** La custodia permite descifrar en el backend, sólo por las vías autorizadas, sin la clave del teléfono. */
  fun envolverDekCustodia(dekHex: String, clavePublicaBase64: String): String {
    val especificacion = X509EncodedKeySpec(Base64.decode(clavePublicaBase64, Base64.DEFAULT))
    val clavePublica = KeyFactory.getInstance("RSA").generatePublic(especificacion)
    val cifrador = Cipher.getInstance("RSA/ECB/OAEPWithSHA-256AndMGF1Padding")
    cifrador.init(
      Cipher.ENCRYPT_MODE,
      clavePublica,
      OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA256, PSource.PSpecified.DEFAULT),
    )
    return base64(cifrador.doFinal(hexABytes(dekHex)))
  }

  private fun clavePrivadaFirma(): PrivateKey {
    val existente = almacen.getKey(ALIAS_FIRMA, null) as PrivateKey?
    return existente ?: generarParFirma()
  }

  private fun generarParFirma(): PrivateKey {
    val generador = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, PROVEEDOR)
    val desafio = ByteArray(32).also { SecureRandom().nextBytes(it) }

    fun especificacion(strongBox: Boolean, atestar: Boolean) =
      KeyGenParameterSpec.Builder(ALIAS_FIRMA, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
        .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
        .setDigests(KeyProperties.DIGEST_SHA256)
        .apply {
          if (atestar) setAttestationChallenge(desafio)
          if (strongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) setIsStrongBoxBacked(true)
        }
        .build()

    // StrongBox y atestación no existen en todos los teléfonos: se baja de nivel hasta poder crearla
    val intentos = listOf(true to true, false to true, false to false)
    var ultimoError: Exception? = null
    for ((strongBox, atestar) in intentos) {
      try {
        generador.initialize(especificacion(strongBox, atestar))
        return generador.generateKeyPair().private
      } catch (error: Exception) {
        ultimoError = error
      }
    }
    throw IllegalStateException("No se pudo crear la clave de firma en el Keystore.", ultimoError)
  }

  private fun claveMaestra(): SecretKey {
    val existente = almacen.getKey(ALIAS_MAESTRA, null) as SecretKey?
    if (existente != null) return existente

    val generador = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVEEDOR)
    fun especificacion(strongBox: Boolean) =
      KeyGenParameterSpec.Builder(ALIAS_MAESTRA, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setKeySize(256)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .apply {
          if (strongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) setIsStrongBoxBacked(true)
        }
        .build()

    return try {
      generador.init(especificacion(strongBox = true))
      generador.generateKey()
    } catch (_: Exception) {
      generador.init(especificacion(strongBox = false))
      generador.generateKey()
    }
  }

  private fun nivelDeSeguridad(clave: PrivateKey): String {
    val informacion = KeyFactory.getInstance(clave.algorithm, PROVEEDOR).getKeySpec(clave, KeyInfo::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      return when (informacion.securityLevel) {
        KeyProperties.SECURITY_LEVEL_STRONGBOX -> "strongbox"
        KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT -> "tee"
        else -> "software"
      }
    }
    @Suppress("DEPRECATION")
    return if (informacion.isInsideSecureHardware) "tee" else "software"
  }

  private fun base64(datos: ByteArray) = Base64.encodeToString(datos, Base64.NO_WRAP)

  private fun hexABytes(hex: String) = ByteArray(hex.length / 2) { i ->
    hex.substring(i * 2, i * 2 + 2).toInt(16).toByte()
  }

  private fun bytesAHex(datos: ByteArray) = datos.joinToString("") { "%02x".format(it) }
}
