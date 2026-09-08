use std::process::Command;
fn main() {
    println!("cargo:rerun-if-env-changed=NOIR_SOURCE_COMMIT");
    println!("cargo:rerun-if-env-changed=NOIR_SOURCE_DIRTY");
    // Read identity on each build, including a checkout with an external gitdir.
    println!("cargo:rerun-if-changed=../../.git");
    println!("cargo:rerun-if-changed=src");
    let git = |args: &[&str]| {
        Command::new("git")
            .args(args)
            .output()
            .ok()
            .filter(|out| out.status.success())
            .and_then(|out| String::from_utf8(out.stdout).ok())
    };
    let commit = std::env::var("NOIR_SOURCE_COMMIT")
        .ok()
        .or_else(|| git(&["rev-parse", "HEAD"]))
        .unwrap_or_else(|| "unknown".into());
    let commit = commit.trim();
    let commit = if commit.len() == 40 && commit.bytes().all(|b| b.is_ascii_hexdigit()) {
        commit
    } else {
        "unknown"
    };
    let dirty = std::env::var("NOIR_SOURCE_DIRTY")
        .ok()
        .or_else(|| git(&["status", "--porcelain"]).map(|value| (!value.is_empty()).to_string()))
        .unwrap_or_else(|| "unknown".into());
    let dirty = match dirty.as_str() {
        "true" => "true",
        "false" => "false",
        _ => "unknown",
    };
    println!("cargo:rustc-env=NOIR_SOURCE_COMMIT={commit}");
    println!("cargo:rustc-env=NOIR_SOURCE_DIRTY={dirty}");
}
