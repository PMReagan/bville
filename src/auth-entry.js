import { signup, login, logout, getUser, oauthLogin, handleAuthCallback, getSettings, requestPasswordRecovery, updateUser, onAuthChange, refreshSession } from "@netlify/identity";
window.NI = { signup, login, logout, getUser, oauthLogin, handleAuthCallback, getSettings, requestPasswordRecovery, updateUser, onAuthChange, refreshSession };
