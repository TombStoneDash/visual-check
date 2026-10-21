// Fixture consumer for the Visual Check gate action (action.yml), used by
// .github/workflows/ci.yml. Served from examples/consumer/site on port 4173.
export default {
  projectId: 'fixture-consumer',
  baseUrl: 'http://127.0.0.1:4173',
  routes: [{ id: 'home', path: '/' }],
  viewports: [
    { name: 'mobile', width: 390, height: 844 },
    { name: 'desktop', width: 1280, height: 800 },
  ],
};
