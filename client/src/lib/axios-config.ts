import axios from 'axios';

// Configure axios defaults for all requests
axios.defaults.withCredentials = true;
axios.defaults.headers.common['Content-Type'] = 'application/json';

// Add request interceptor for debugging
axios.interceptors.request.use(
  (config) => {
    console.log('Making request:', {
      method: config.method,
      url: config.url,
      withCredentials: config.withCredentials,
      headers: config.headers
    });
    return config;
  },
  (error) => {
    console.error('Request interceptor error:', error);
    return Promise.reject(error);
  }
);

// Add response interceptor for debugging
axios.interceptors.response.use(
  (response) => {
    console.log('Response received:', {
      status: response.status,
      url: response.config.url,
      data: response.data
    });
    return response;
  },
  (error) => {
    console.error('Response interceptor error:', {
      status: error.response?.status,
      url: error.config?.url,
      message: error.message,
      data: error.response?.data
    });
    return Promise.reject(error);
  }
);

export default axios;