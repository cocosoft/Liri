use std::process::Command;
fn main() {
    let output = Command::new("rustc").arg("--version").output();
    match output {
        Ok(o) => println!("OK: {}", String::from_utf8_lossy(&o.stdout)),
        Err(e) => println!("ERR: {:?}", e),
    }
}
