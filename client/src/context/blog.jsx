import { createContext, useContext, useState, useEffect } from "react";
import PropTypes from "prop-types";

const BlogContext = createContext();

export function BlogProvider({ children }) {
  const [posts, setPosts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const storedPosts = localStorage.getItem("blogPosts");
    if (storedPosts) {
      try {
        const parsedPosts = JSON.parse(storedPosts);
        setPosts(Array.isArray(parsedPosts) ? parsedPosts : []);
      } catch {
        setPosts([]);
      }
    }
    setIsLoading(false);
  }, []);

  const savePosts = (newPosts) => {
    setPosts(newPosts);
    localStorage.setItem('blogPosts', JSON.stringify(newPosts));
  };

  const createPost = (postData) => {
    const newPost = {
      id: Date.now(),
      ...postData,
      date: new Date().toISOString(),
      author: "Admin"
    };
    const newPosts = [newPost, ...posts];
    savePosts(newPosts);
    return newPost;
  };

  const updatePost = (postId, postData) => {
    const newPosts = posts.map(post => 
      post.id === postId 
        ? { ...post, ...postData, date: new Date().toISOString() }
        : post
    );
    savePosts(newPosts);
  };

  const deletePost = (postId) => {
    const newPosts = posts.filter(post => post.id !== postId);
    savePosts(newPosts);
  };

  const getPublishedPosts = () => {
    return posts.filter(post => post.published);
  };

  const getPostById = (id) => {
    return posts.find(post => post.id === parseInt(id, 10));
  };

  const value = {
    posts,
    isLoading,
    createPost,
    updatePost,
    deletePost,
    getPublishedPosts,
    getPostById
  };

  return (
    <BlogContext.Provider value={value}>
      {children}
    </BlogContext.Provider>
  );
}

export function useBlog() {
  const context = useContext(BlogContext);
  if (!context) {
    throw new Error('useBlog must be used within a BlogProvider');
  }
  return context;
}

BlogProvider.propTypes = {
  children: PropTypes.node.isRequired,
};
