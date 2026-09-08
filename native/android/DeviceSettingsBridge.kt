package com.resto237.integration

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.webkit.WebView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

/** Call on the UI thread BEFORE loading the trusted website. */
object DeviceSettingsBridge {
    fun install(activity: Activity, webView: WebView): Boolean {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return false
        val origin = "https://resto237.vercel.app"
        WebViewCompat.addWebMessageListener(
            webView, "Resto237DeviceSettings", setOf(origin)
        ) { _, message, sourceOrigin, isMainFrame, reply ->
            if (!isMainFrame || sourceOrigin.toString() != origin) return@addWebMessageListener
            val request = try { JSONObject(message.data ?: "") } catch (_: Exception) { return@addWebMessageListener }
            if (request.optString("action") != "openBatterySettings") return@addWebMessageListener
            val id = request.optString("id")
            if (id.isEmpty() || id.length > 100) return@addWebMessageListener
            // No exemption permission and no automatic permission changes.
            val intents = listOf(
                Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS),
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${activity.packageName}"))
            )
            var opened = false
            for (intent in intents) {
                try {
                    activity.startActivity(intent)
                    opened = true
                    break
                } catch (_: ActivityNotFoundException) {
                    // Some manufacturers omit the battery screen; use app details.
                } catch (_: SecurityException) {
                    // Fall back to app details when settings access is restricted.
                }
            }
            reply.postMessage(JSONObject().put("id", id).put("opened", opened).toString())
        }
        return true
    }
}
