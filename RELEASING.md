# Releasing CardForge

## One-time setup: the Android signing key

Android only installs an update over an existing app when both are signed with the same key. CI builds use a
temporary key until you add a permanent one, so set this up once (ideally before the first release) and keep the key safe:
if it is lost, installed copies can't be updated and users must uninstall first.

1. Create the key. `keytool` comes with Java (Android Studio has it in `jbr\bin`). In PowerShell:

   ```powershell
   keytool -genkeypair -v -keystore cardforge-release.jks -alias cardforge -keyalg RSA -keysize 4096 -validity 10000
   ```

   Choose a password and remember it. The name and organisation questions can be anything.

2. Turn the key into text for GitHub:

   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("cardforge-release.jks")) | Set-Content cardforge-release.txt
   ```

3. On GitHub, open the repository's **Settings → Secrets and variables → Actions** and add three repository secrets:

   | Name | Value |
   | --- | --- |
   | `ANDROID_KEYSTORE_BASE64` | the contents of `cardforge-release.txt` |
   | `ANDROID_KEYSTORE_PASSWORD` | the password from step 1 |
   | `ANDROID_KEY_ALIAS` | `cardforge` |

4. Keep `cardforge-release.jks` and its password somewhere safe (a password manager), then delete
   `cardforge-release.txt`. Never commit either file.

## Publishing a release

1. Make sure the version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` is the one you
   want to release (it is `0.1.0` now). For later releases, raise all three, e.g. to `0.2.0`, and merge that first.
2. On GitHub, open **Releases → Draft a new release**. Create the tag `v` plus the version (e.g. `v0.1.0`) on `main`,
   give it a title and notes, and click **Publish release**.
3. The Build workflow runs for the release. When it finishes (about 15 minutes), the Windows installers
   (`.exe`, `.msi`) and the APK are attached to the release.

The workflow refuses to attach anything if the tag doesn't match the version. Without the signing key secrets, the
APK is signed with a temporary key: it installs, but the next build can't update it, so uninstall it first. Uninstalling deletes the
cards stored in the app, so export them first. Once the permanent key is set up, updates install over each other.
