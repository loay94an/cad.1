#![cfg(target_os = "android")]

mod app;
mod browser;
mod calibrate;
mod canvas;
mod dialogs;
mod chrome;
mod editbar;
mod eyedrop;
mod gpu;
mod grbl_ui;
mod print;
mod icon;
mod icons;
mod panels;
mod panels2;
mod paramspanel;
mod prepare_ui;
mod queue_ui;
mod recovery;
mod render;
mod webui;
mod wizards;
mod startup;

#[unsafe(no_mangle)]
fn android_main(app: winit::platform::android::activity::AndroidApp) {
    android_logger::init_once(
        android_logger::Config::default().with_max_level(log::LevelFilter::Info),
    );
    let options = eframe::NativeOptions {
        android_app: Some(app),
        ..Default::default()
    };
    if let Err(error) = eframe::run_native(
        "CutCraft",
        options,
        Box::new(|cc| Ok(Box::new(app::App::new(cc)))),
    ) {
        log::error!("CutCraft failed to start: {error}");
    }
}
