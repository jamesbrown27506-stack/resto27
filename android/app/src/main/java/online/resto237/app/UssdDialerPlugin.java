package online.resto237.app;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Dials an Orange Money payment code for the customer.
 *
 * Since 2026-09 Orange makes the customer start every payment: they dial
 * "#150*14*…*amount#" themselves. A tel: link from the web page can only open
 * the dialler with the code typed in; with the phone permission this places
 * the call, so the Orange menu opens at once. Refused (or unavailable on the
 * device), it falls back to the dialler, which needs no permission.
 *
 * ONLY "#150*…#" IS EVER DIALLED. The WebView shows a remote page, and a
 * plugin that ran any string would let that page set call forwarding
 * ("**21*…#") or ring a premium number. The pattern is checked here, on the
 * native side, whatever the JavaScript sent.
 */
@CapacitorPlugin(
    name = "UssdDialer",
    permissions = { @Permission(alias = "call", strings = { Manifest.permission.CALL_PHONE }) }
)
public class UssdDialerPlugin extends Plugin {
    private static final String ORANGE_MONEY_CODE = "^#150\\*[0-9*]{3,60}#$";

    @PluginMethod
    public void dial(PluginCall call) {
        String code = call.getString("code", "");
        if (code == null || !code.matches(ORANGE_MONEY_CODE)) {
            call.reject("Not an Orange Money code.");
            return;
        }
        if (getPermissionState("call") != PermissionState.GRANTED) {
            requestPermissionForAlias("call", call, "callPermissionResult");
            return;
        }
        start(call, code, true);
    }

    @PermissionCallback
    private void callPermissionResult(PluginCall call) {
        String code = call.getString("code", "");
        if (code == null || !code.matches(ORANGE_MONEY_CODE)) {
            call.reject("Not an Orange Money code.");
            return;
        }
        start(call, code, getPermissionState("call") == PermissionState.GRANTED);
    }

    /** `direct`: the permission is held, so the call may be placed outright. */
    private void start(PluginCall call, String code, boolean direct) {
        // '#' must be encoded: a raw one ends the URI and the code is cut short.
        Uri uri = Uri.parse("tel:" + Uri.encode(code));
        boolean started = false;
        boolean placed = false;

        if (direct) {
            try {
                getActivity().startActivity(new Intent(Intent.ACTION_CALL, uri));
                started = true;
                placed = true;
            } catch (ActivityNotFoundException | SecurityException ignored) {
                // No telephony, or the permission was revoked a moment ago.
            }
        }
        if (!started) {
            try {
                getActivity().startActivity(new Intent(Intent.ACTION_DIAL, uri));
                started = true;
            } catch (ActivityNotFoundException | SecurityException ignored) {
                // A tablet without a dialler: the page keeps its Copy button.
            }
        }

        JSObject result = new JSObject();
        result.put("started", started);
        result.put("direct", placed);
        call.resolve(result);
    }
}
