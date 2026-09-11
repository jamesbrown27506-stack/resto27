package online.resto237.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Downloads a new APK into the app's own cache and hands it to Android's
 * installer — so updating is "Mettre à jour", a progress bar, then Android's
 * "Update this app?" screen, with no trip through the browser's downloads
 * (where every copy was named Resto237.apk and the wrong one got opened).
 *
 * Only for the sideloaded build: Google Play forbids apps that install their
 * own updates, and the REQUEST_INSTALL_PACKAGES permission this needs. A Play
 * build must drop this plugin, its registration and that permission.
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {
    /** Updates come from the platform's own origin and nowhere else. */
    private static final String HOST = "resto237.online";

    private File updatesDir() {
        File dir = new File(getContext().getCacheDir(), "updates");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    private static boolean safeName(String name) {
        return name != null && name.matches("[A-Za-z0-9._-]{1,80}\\.apk");
    }

    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url");
        String fileName = call.getString("fileName");
        if (url == null || !safeName(fileName)) {
            call.reject("Invalid update file.");
            return;
        }
        final URL parsed;
        try {
            parsed = new URL(url);
        } catch (Exception e) {
            call.reject("Invalid update URL.");
            return;
        }
        if (!"https".equals(parsed.getProtocol()) || !HOST.equals(parsed.getHost())) {
            call.reject("Updates only come from https://" + HOST + ".");
            return;
        }

        new Thread(() -> {
            File dir = updatesDir();
            File target = new File(dir, fileName);
            File partial = new File(dir, fileName + ".part");
            HttpURLConnection connection = null;
            try {
                // An older version is dead weight in the cache once a newer one arrives.
                File[] old = dir.listFiles();
                if (old != null) {
                    for (File file : old) {
                        if (!file.getName().equals(fileName)) file.delete();
                    }
                }

                connection = (HttpURLConnection) parsed.openConnection();
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(30000);
                connection.setInstanceFollowRedirects(true);
                int code = connection.getResponseCode();
                if (code != HttpURLConnection.HTTP_OK) throw new Exception("HTTP " + code);

                long total = connection.getContentLengthLong();
                long done = 0;
                int lastPercent = -1;
                try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(partial)) {
                    byte[] buffer = new byte[64 * 1024];
                    int read;
                    while ((read = in.read(buffer)) != -1) {
                        out.write(buffer, 0, read);
                        done += read;
                        if (total > 0) {
                            int percent = (int) (done * 100 / total);
                            if (percent != lastPercent) {
                                lastPercent = percent;
                                JSObject progress = new JSObject();
                                progress.put("percent", percent);
                                notifyListeners("progress", progress);
                            }
                        }
                    }
                }

                if (target.exists()) target.delete();
                if (!partial.renameTo(target)) throw new Exception("Could not save the update.");
                JSObject result = new JSObject();
                result.put("fileName", fileName);
                result.put("bytes", done);
                call.resolve(result);
            } catch (Exception e) {
                partial.delete();
                call.reject("Download failed: " + e.getMessage());
            } finally {
                if (connection != null) connection.disconnect();
            }
        }).start();
    }

    @PluginMethod
    public void install(PluginCall call) {
        String fileName = call.getString("fileName");
        File file = safeName(fileName) ? new File(updatesDir(), fileName) : null;
        if (file == null || !file.exists()) {
            call.reject("The update has not been downloaded.");
            return;
        }

        JSObject result = new JSObject();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !getContext().getPackageManager().canRequestPackageInstalls()) {
            // Android asks once per app ("Allow from this source"). The page
            // calls install() again when the app comes back to the front.
            try {
                getActivity().startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getContext().getPackageName())));
            } catch (ActivityNotFoundException ignored) {
                // No such screen on this phone: the page explains where it is.
            }
            result.put("status", "needs-permission");
            call.resolve(result);
            return;
        }

        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getActivity().startActivity(intent);
            result.put("status", "installer-opened");
            call.resolve(result);
        } catch (ActivityNotFoundException e) {
            call.reject("No installer available on this phone.");
        }
    }
}
