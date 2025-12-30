// 提醒：src/App.tsx
import { RouterProvider } from 'react-router-dom';
import { router } from './root/router';
import { AuthProvider } from './auth/AuthContext';
import { FavoritesProvider } from './favorites/FavoritesContext';

function App() {
  return (
    <AuthProvider>
      <FavoritesProvider>
        <RouterProvider router={router} />
      </FavoritesProvider>
    </AuthProvider>
  );
}

export default App;
