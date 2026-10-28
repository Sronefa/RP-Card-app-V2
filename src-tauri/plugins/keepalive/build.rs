const COMMANDS: &[&str] = &["start", "update", "stop"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).android_path("android").build();
}
