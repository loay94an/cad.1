import { createApp } from 'vue';
import App from './App.vue';
import { finishSilentRenew, isSilentRenewFrame } from './auth/session';
import './styles.css';

// In the hidden iframe of a silent renew, only pass the provider's answer to the app.
if (isSilentRenewFrame()) void finishSilentRenew();
else createApp(App).mount('#app');
