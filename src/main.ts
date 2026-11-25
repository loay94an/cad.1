import { createApp } from 'vue';
import App from './App.vue';
import { finishSilentRenew, isSilentRenewFrame } from './auth/session';
import './styles.css';
import { installArabicUi } from './i18n/ar';

// In the hidden iframe of a silent renew, only pass the provider's answer to the app.
if (isSilentRenewFrame()) void finishSilentRenew();
else {
  document.documentElement.lang = 'ar';
  document.documentElement.dir = 'rtl';
  document.documentElement.setAttribute('data-locale', 'ar');
  createApp(App).mount('#app');
  installArabicUi();
}
