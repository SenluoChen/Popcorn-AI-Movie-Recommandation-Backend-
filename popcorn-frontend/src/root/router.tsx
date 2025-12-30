// src/routes/router.tsx...
import { createBrowserRouter } from 'react-router-dom';
import Root from './Root';
import HomePage from '../pages/HomePage';
import MovieDetail from '../pages/MovieDetail';
import SearchResultsPage from '../pages/SearchResultsPage';
import MyListPage from '../pages/MyListPage';

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Root />, // 主 Layout...
    children: [
      {
        index: true, // 預設首頁...
        element: <HomePage />,
      },
      {
        path: "dashboard", // 另一個首頁入口...
        element: <HomePage />,
      },
      {
        path: "movie/:id",
        element: <MovieDetail />,
      },
      {
        path: "search",
        element: <SearchResultsPage />,
      },
      {
        path: "my-list",
        element: <MyListPage />,
      },
    ],
  },
]);

export default router;