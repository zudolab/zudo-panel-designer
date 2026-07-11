import { ZPD_CORE_VERSION } from '@zpd/core';

function App() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 text-neutral-100">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">zpd — Zudo Panel Designer</h1>
        <p className="mt-2 text-sm text-neutral-400">core v{ZPD_CORE_VERSION}</p>
      </div>
    </main>
  );
}

export default App;
