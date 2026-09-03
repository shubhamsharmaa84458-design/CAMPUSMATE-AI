// Initialize a global fetch wrapper that injects Authorization: Bearer <token>
// This ensures any fetch call from the app sends the campusmate_token when available.
(function(){
  if (typeof window === 'undefined' || !window.fetch) return;
  try {
    const _orig = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      init = init || {};
      init.headers = init.headers || {};
      try {
        const token = localStorage.getItem('campusmate_token');
        const existingAuth = init.headers['Authorization'] || init.headers['authorization'] || '';
        if (token && (!existingAuth || existingAuth.toString().includes('*') || existingAuth.toString().startsWith('`') || !existingAuth.toString().startsWith('Bearer '))) {
          init.headers['Authorization'] = `Bearer ${token}`;
        }
      } catch (e) {
        // ignore
      }
      return _orig(input, init);
    };
  } catch (e) {
    // ignore
  }
})();
