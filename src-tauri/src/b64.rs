use base64::{Engine as _, engine::general_purpose};

/// Base64 encode a byte slice.
pub fn encode(data: &[u8]) -> String {
    general_purpose::STANDARD.encode(data)
}
