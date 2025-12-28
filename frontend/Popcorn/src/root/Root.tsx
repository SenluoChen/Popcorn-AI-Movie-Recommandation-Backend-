
import { Outlet } from 'react-router-dom';
import ScrollToTop from "../components/ScrollToTop";




function Root() {
  return (
    <div>
     
          <ScrollToTop />
      <Outlet />
    </div>
  );
}

export default Root;
