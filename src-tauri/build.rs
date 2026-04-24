fn main() {
    // Embed a minimal Info.plist into the debug binary so that macOS reads
    // CFBundleName / CFBundleDisplayName from __TEXT,__info_plist and shows
    // "GnarTerm (Dev)" in the app switcher when running `tauri dev`.
    // The bundled release build has its own Info.plist; this only applies to
    // the raw unbundled debug binary.
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let profile = std::env::var("PROFILE").unwrap_or_default();
    if profile == "debug" && target_os == "macos" {
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
        let plist = format!("{manifest_dir}/Info.dev.plist");
        println!("cargo:rustc-link-arg=-sectcreate");
        println!("cargo:rustc-link-arg=__TEXT");
        println!("cargo:rustc-link-arg=__info_plist");
        println!("cargo:rustc-link-arg={plist}");
    }
    tauri_build::build();
}
