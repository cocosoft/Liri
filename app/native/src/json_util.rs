use std::collections::BTreeMap;

#[derive(Debug, Clone)]
pub enum JsonValue {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Array(Vec<JsonValue>),
    Object(BTreeMap<String, JsonValue>),
}

impl JsonValue {
    pub fn as_str(&self) -> Option<&str> {
        match self {
            JsonValue::String(s) => Some(s.as_str()),
            _ => None,
        }
    }

    pub fn as_f64(&self) -> Option<f64> {
        match self {
            JsonValue::Number(n) => Some(*n),
            _ => None,
        }
    }

    pub fn as_i64(&self) -> Option<i64> {
        self.as_f64().map(|n| n as i64)
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            JsonValue::Bool(b) => Some(*b),
            _ => None,
        }
    }

    pub fn as_array(&self) -> Option<&Vec<JsonValue>> {
        match self {
            JsonValue::Array(a) => Some(a),
            _ => None,
        }
    }

    pub fn as_object(&self) -> Option<&BTreeMap<String, JsonValue>> {
        match self {
            JsonValue::Object(o) => Some(o),
            _ => None,
        }
    }

    pub fn get(&self, key: &str) -> Option<&JsonValue> {
        self.as_object().and_then(|o| o.get(key))
    }

    pub fn to_json_string(&self) -> String {
        let mut out = String::new();
        self.write_json(&mut out);
        out
    }

    fn write_json(&self, out: &mut String) {
        match self {
            JsonValue::Null => out.push_str("null"),
            JsonValue::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
            JsonValue::Number(n) => {
                if *n == n.floor() && n.is_finite() {
                    write!(out, "{}", *n as i64).unwrap();
                } else {
                    write!(out, "{}", *n).unwrap();
                }
            }
            JsonValue::String(s) => {
                out.push('"');
                for ch in s.chars() {
                    match ch {
                        '"' => out.push_str("\\\""),
                        '\\' => out.push_str("\\\\"),
                        '\n' => out.push_str("\\n"),
                        '\r' => out.push_str("\\r"),
                        '\t' => out.push_str("\\t"),
                        c if c < ' ' => write!(out, "\\u{:04x}", c as u32).unwrap(),
                        c => out.push(c),
                    }
                }
                out.push('"');
            }
            JsonValue::Array(arr) => {
                out.push('[');
                for (i, v) in arr.iter().enumerate() {
                    if i > 0 { out.push(','); }
                    v.write_json(out);
                }
                out.push(']');
            }
            JsonValue::Object(obj) => {
                out.push('{');
                for (i, (k, v)) in obj.iter().enumerate() {
                    if i > 0 { out.push(','); }
                    JsonValue::String(k.clone()).write_json(out);
                    out.push(':');
                    v.write_json(out);
                }
                out.push('}');
            }
        }
    }
}

pub fn parse_json(input: &str) -> Result<JsonValue, String> {
    let chars: Vec<char> = input.chars().collect();
    let mut pos = 0;
    skip_whitespace(&chars, &mut pos);
    let value = parse_value(&chars, &mut pos)?;
    Ok(value)
}

fn skip_whitespace(chars: &[char], pos: &mut usize) {
    while *pos < chars.len() && chars[*pos].is_ascii_whitespace() {
        *pos += 1;
    }
}

fn parse_value(chars: &[char], pos: &mut usize) -> Result<JsonValue, String> {
    skip_whitespace(chars, pos);
    if *pos >= chars.len() {
        return Err("Unexpected end of input".to_string());
    }
    match chars[*pos] {
        'n' => parse_null(chars, pos),
        't' => parse_true(chars, pos),
        'f' => parse_false(chars, pos),
        '"' => parse_string(chars, pos).map(JsonValue::String),
        '[' => parse_array(chars, pos),
        '{' => parse_object(chars, pos),
        '-' | '0'..='9' => parse_number(chars, pos),
        c => Err(format!("Unexpected character '{}' at position {}", c, pos)),
    }
}

fn parse_null(chars: &[char], pos: &mut usize) -> Result<JsonValue, String> {
    if chars.len() - *pos < 4 || &chars[*pos..*pos+4] == ['n', 'u', 'l', 'l'] {
        *pos += 4;
        Ok(JsonValue::Null)
    } else {
        Err("Expected 'null'".to_string())
    }
}

fn parse_true(chars: &[char], pos: &mut usize) -> Result<JsonValue, String> {
    if chars.len() - *pos >= 4 && chars[*pos..*pos+4] == ['t', 'r', 'u', 'e'] {
        *pos += 4;
        Ok(JsonValue::Bool(true))
    } else {
        Err("Expected 'true'".to_string())
    }
}

fn parse_false(chars: &[char], pos: &mut usize) -> Result<JsonValue, String> {
    if chars.len() - *pos >= 5 && chars[*pos..*pos+5] == ['f', 'a', 'l', 's', 'e'] {
        *pos += 5;
        Ok(JsonValue::Bool(false))
    } else {
        Err("Expected 'false'".to_string())
    }
}

fn parse_string(chars: &[char], pos: &mut usize) -> Result<String, String> {
    if chars[*pos] != '"' {
        return Err("Expected '\"'".to_string());
    }
    *pos += 1;
    let mut s = String::new();
    while *pos < chars.len() {
        match chars[*pos] {
            '"' => {
                *pos += 1;
                return Ok(s);
            }
            '\\' => {
                *pos += 1;
                if *pos >= chars.len() {
                    return Err("Unexpected end in string escape".to_string());
                }
                match chars[*pos] {
                    '"' => s.push('"'),
                    '\\' => s.push('\\'),
                    '/' => s.push('/'),
                    'n' => s.push('\n'),
                    'r' => s.push('\r'),
                    't' => s.push('\t'),
                    'u' => {
                        let hex: String = chars[*pos+1..*pos+5].iter().collect();
                        let code = u32::from_str_radix(&hex, 16).map_err(|_| "Invalid unicode escape".to_string())?;
                        if let Some(c) = char::from_u32(code) {
                            s.push(c);
                        }
                        *pos += 4;
                    }
                    c => return Err(format!("Invalid escape character '{}'", c)),
                }
                *pos += 1;
            }
            c => {
                s.push(c);
                *pos += 1;
            }
        }
    }
    Err("Unterminated string".to_string())
}

fn parse_number(chars: &[char], pos: &mut usize) -> Result<JsonValue, String> {
    let start = *pos;
    if *pos < chars.len() && chars[*pos] == '-' {
        *pos += 1;
    }
    while *pos < chars.len() && chars[*pos].is_ascii_digit() {
        *pos += 1;
    }
    let _is_float = if *pos < chars.len() && chars[*pos] == '.' {
        *pos += 1;
        while *pos < chars.len() && chars[*pos].is_ascii_digit() {
            *pos += 1;
        }
        true
    } else {
        false
    };
    if *pos < chars.len() && (chars[*pos] == 'e' || chars[*pos] == 'E') {
        *pos += 1;
        if *pos < chars.len() && (chars[*pos] == '+' || chars[*pos] == '-') {
            *pos += 1;
        }
        while *pos < chars.len() && chars[*pos].is_ascii_digit() {
            *pos += 1;
        }
    }
    let num_str: String = chars[start..*pos].iter().collect();
    let n: f64 = num_str.parse().map_err(|_| format!("Invalid number: {}", num_str))?;
    Ok(JsonValue::Number(n))
}

fn parse_array(chars: &[char], pos: &mut usize) -> Result<JsonValue, String> {
    if chars[*pos] != '[' {
        return Err("Expected '['".to_string());
    }
    *pos += 1;
    let mut arr = Vec::new();
    skip_whitespace(chars, pos);
    if *pos < chars.len() && chars[*pos] == ']' {
        *pos += 1;
        return Ok(JsonValue::Array(arr));
    }
    loop {
        let value = parse_value(chars, pos)?;
        arr.push(value);
        skip_whitespace(chars, pos);
        if *pos >= chars.len() {
            return Err("Unterminated array".to_string());
        }
        if chars[*pos] == ']' {
            *pos += 1;
            return Ok(JsonValue::Array(arr));
        }
        if chars[*pos] != ',' {
            return Err(format!("Expected ',' or ']' in array at position {}", pos));
        }
        *pos += 1;
    }
}

fn parse_object(chars: &[char], pos: &mut usize) -> Result<JsonValue, String> {
    if chars[*pos] != '{' {
        return Err("Expected '{{'".to_string());
    }
    *pos += 1;
    let mut obj = BTreeMap::new();
    skip_whitespace(chars, pos);
    if *pos < chars.len() && chars[*pos] == '}' {
        *pos += 1;
        return Ok(JsonValue::Object(obj));
    }
    loop {
        skip_whitespace(chars, pos);
        if *pos >= chars.len() || chars[*pos] != '"' {
            return Err("Expected string key in object".to_string());
        }
        let key = parse_string(chars, pos)?;
        skip_whitespace(chars, pos);
        if *pos >= chars.len() || chars[*pos] != ':' {
            return Err("Expected ':' in object".to_string());
        }
        *pos += 1;
        let value = parse_value(chars, pos)?;
        obj.insert(key, value);
        skip_whitespace(chars, pos);
        if *pos >= chars.len() {
            return Err("Unterminated object".to_string());
        }
        if chars[*pos] == '}' {
            *pos += 1;
            return Ok(JsonValue::Object(obj));
        }
        if chars[*pos] != ',' {
            return Err(format!("Expected ',' or '}}' in object at position {}", pos));
        }
        *pos += 1;
    }
}

use std::fmt::Write;
