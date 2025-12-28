// 提醒：src/App.tsx
import { RouterProvider } from 'react-router-dom';
import { router } from './root/router';

function App() {
  return (
    <RouterProvider router={router} />
  );
}

export default App;
