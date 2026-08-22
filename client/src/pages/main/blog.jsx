import { Navigate } from "react-router-dom";

// Keep old bookmarks working without presenting browser-local drafts as
// published company content. The maintained public articles live in Insights.
export function Blog() {
  return <Navigate to="/main/insights" replace />;
}

export default Blog;
