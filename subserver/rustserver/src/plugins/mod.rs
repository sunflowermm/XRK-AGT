mod regex_tools;

use axum::Router;
use std::sync::Arc;

use crate::core::command_registry::{CommandHandler, CommandRegistry, PluginSet};

pub fn register_all(registry: &CommandRegistry) {
    regex_tools::register(registry);
}

pub fn attach_routes<S>(router: Router<S>) -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    regex_tools::attach_routes(router)
}

pub fn cmd_handler<F>(f: F) -> CommandHandler
where
    F: Fn(&[String]) -> serde_json::Value + Send + Sync + 'static,
{
    Arc::new(f)
}

pub fn plugin_set(
    group: &str,
    name: &str,
    description: &str,
    plugin_dir: &str,
    commands: Vec<(&str, CommandHandler)>,
) -> PluginSet {
    PluginSet {
        group: group.into(),
        name: name.into(),
        description: description.into(),
        plugin_dir: plugin_dir.into(),
        commands: commands
            .into_iter()
            .map(|(k, v)| (k.into(), v))
            .collect(),
    }
}
