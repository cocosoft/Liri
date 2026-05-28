// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

use crate::{Message, Session, Tool};

#[cfg(test)]
mod session_tests {
    use super::*;

    #[test]
    fn test_session_creation() {
        let now = chrono::Utc::now().timestamp_millis();
        let session = Session {
            id: "test-id-123".to_string(),
            title: "Test Session".to_string(),
            created_at: now,
            last_modified_at: now,
            message_count: 0,
        };

        assert_eq!(session.id, "test-id-123");
        assert_eq!(session.title, "Test Session");
        assert_eq!(session.message_count, 0);
        assert_eq!(session.created_at, session.last_modified_at);
    }

    #[test]
    fn test_session_message_count_update() {
        let now = chrono::Utc::now().timestamp_millis();
        let mut session = Session {
            id: "test-id-456".to_string(),
            title: "Test Session 2".to_string(),
            created_at: now,
            last_modified_at: now,
            message_count: 0,
        };

        session.message_count = 5;
        assert_eq!(session.message_count, 5);

        session.last_modified_at = chrono::Utc::now().timestamp_millis();
        assert!(session.last_modified_at >= now);
    }
}

#[cfg(test)]
mod message_tests {
    use super::*;

    #[test]
    fn test_message_creation() {
        let now = chrono::Utc::now().timestamp_millis();
        let msg = Message {
            id: "msg-id-123".to_string(),
            role: "user".to_string(),
            content: "Hello, World!".to_string(),
            timestamp: now,
            session_id: "session-1".to_string(),
        };

        assert_eq!(msg.id, "msg-id-123");
        assert_eq!(msg.role, "user");
        assert_eq!(msg.content, "Hello, World!");
        assert_eq!(msg.session_id, "session-1");
    }

    #[test]
    fn test_message_roles() {
        let now = chrono::Utc::now().timestamp_millis();

        let user_msg = Message {
            id: "msg-1".to_string(),
            role: "user".to_string(),
            content: "User message".to_string(),
            timestamp: now,
            session_id: "s1".to_string(),
        };

        let assistant_msg = Message {
            id: "msg-2".to_string(),
            role: "assistant".to_string(),
            content: "Assistant message".to_string(),
            timestamp: now,
            session_id: "s1".to_string(),
        };

        assert_eq!(user_msg.role, "user");
        assert_eq!(assistant_msg.role, "assistant");
    }
}

#[cfg(test)]
mod tool_tests {
    use super::*;

    #[test]
    fn test_tool_creation() {
        let tool = Tool {
            name: "read".to_string(),
            description: "Read file content".to_string(),
            enabled: true,
            read_only: true,
            destructive: false,
        };

        assert_eq!(tool.name, "read");
        assert!(tool.enabled);
        assert!(tool.read_only);
        assert!(!tool.destructive);
    }

    #[test]
    fn test_tool_properties() {
        let tools = vec![
            Tool {
                name: "read".to_string(),
                description: "Read file".to_string(),
                enabled: true,
                read_only: true,
                destructive: false,
            },
            Tool {
                name: "write".to_string(),
                description: "Write file".to_string(),
                enabled: true,
                read_only: false,
                destructive: false,
            },
            Tool {
                name: "delete".to_string(),
                description: "Delete file".to_string(),
                enabled: false,
                read_only: false,
                destructive: true,
            },
        ];

        assert_eq!(tools.len(), 3);
        assert!(tools[0].read_only);
        assert!(!tools[1].read_only);
        assert!(tools[2].destructive);
        assert!(!tools[2].enabled);
    }
}

#[cfg(test)]
mod command_tests {
    use crate::commands::session::AppState;
    use crate::Session;

    #[test]
    fn test_app_state_default() {
        let state = AppState::default();

        let sessions = state.sessions.lock().unwrap();
        assert!(sessions.is_empty());

        let current_id = state.current_session_id.lock().unwrap();
        assert!(current_id.is_none());
    }

    #[test]
    fn test_app_state_sessions() {
        let state = AppState::default();

        {
            let mut sessions = state.sessions.lock().unwrap();
            let now = chrono::Utc::now().timestamp_millis();
            sessions.push(Session {
                id: "s1".to_string(),
                title: "Session 1".to_string(),
                created_at: now,
                last_modified_at: now,
                message_count: 0,
            });
        }

        let sessions = state.sessions.lock().unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].title, "Session 1");
    }

    #[test]
    fn test_app_state_current_session() {
        let state = AppState::default();

        {
            let mut current_id = state.current_session_id.lock().unwrap();
            *current_id = Some("current-s1".to_string());
        }

        let current_id = state.current_session_id.lock().unwrap();
        assert_eq!(*current_id, Some("current-s1".to_string()));
    }
}

#[cfg(test)]
mod config_tests {
    use crate::commands::config::ConfigState;

    #[test]
    fn test_config_state_default() {
        let state = ConfigState::default();

        let config = state.config.lock().unwrap();
        assert!(config.contains_key("theme"));
        assert!(config.contains_key("language"));
        assert!(config.contains_key("fontSize"));

        assert_eq!(config.get("theme"), Some(&serde_json::json!("light")));
        assert_eq!(config.get("language"), Some(&serde_json::json!("zh-CN")));
        assert_eq!(config.get("fontSize"), Some(&serde_json::json!(14)));
    }

    #[test]
    fn test_config_update() {
        let state = ConfigState::default();

        {
            let mut config = state.config.lock().unwrap();
            config.insert("theme".to_string(), serde_json::json!("dark"));
        }

        let config = state.config.lock().unwrap();
        assert_eq!(config.get("theme"), Some(&serde_json::json!("dark")));
    }

    #[test]
    fn test_config_new_key() {
        let state = ConfigState::default();

        {
            let mut config = state.config.lock().unwrap();
            config.insert(
                "newSetting".to_string(),
                serde_json::json!("value123"),
            );
        }

        let config = state.config.lock().unwrap();
        assert!(config.contains_key("newSetting"));
        assert_eq!(config.get("newSetting"), Some(&serde_json::json!("value123")));
    }
}
