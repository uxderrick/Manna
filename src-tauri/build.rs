fn main() {
    let flavor = std::env::var("MANNA_FLAVOR").unwrap_or_else(|_| "minimal".to_string());
    println!("cargo:rustc-env=MANNA_FLAVOR={flavor}");
    println!("cargo:rerun-if-env-changed=MANNA_FLAVOR");
    tauri_build::build();
}
