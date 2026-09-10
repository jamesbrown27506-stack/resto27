package online.resto237.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BatterySettings")
public class BatterySettingsPlugin extends Plugin {
    @PluginMethod
    public void open(PluginCall call) {
        boolean opened = false;
        Intent[] intents = new Intent[] {
            new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS),
            new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + getContext().getPackageName()))
        };
        for (Intent intent : intents) {
            try {
                getActivity().startActivity(intent);
                opened = true;
                break;
            } catch (ActivityNotFoundException | SecurityException ignored) {
                // Some manufacturers omit the battery screen; try app details.
            }
        }
        JSObject result = new JSObject();
        result.put("opened", opened);
        call.resolve(result);
    }
}
