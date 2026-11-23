//! Android dialog adapter. Native document-provider integration is implemented separately.
use std::path::PathBuf;

pub struct FileDialog;
impl FileDialog {
    pub fn new() -> Self { Self }
    pub fn add_filter<T: ToString>(self, _name: impl Into<String>, _extensions: &[T]) -> Self { self }
    pub fn set_file_name(self, _name: impl Into<String>) -> Self { self }
    pub fn save_file(self) -> Option<PathBuf> { None }
    pub fn pick_file(self) -> Option<PathBuf> { None }
    pub fn pick_files(self) -> Option<Vec<PathBuf>> { None }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum MessageDialogResult { Yes, No, Ok, Cancel }
#[derive(Clone, Copy)]
pub enum MessageButtons { YesNo, Ok }
pub struct MessageDialog;
impl MessageDialog {
    pub fn new() -> Self { Self }
    pub fn set_title(self, _title: impl Into<String>) -> Self { self }
    pub fn set_description(self, _description: impl Into<String>) -> Self { self }
    pub fn set_buttons(self, _buttons: MessageButtons) -> Self { self }
    pub fn show(self) -> MessageDialogResult { MessageDialogResult::No }
}
