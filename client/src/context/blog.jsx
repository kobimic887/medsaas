import React, { createContext, useContext, useState, useEffect } from "react";
import PropTypes from "prop-types";

const BlogContext = createContext();

export function BlogProvider({ children }) {
  const [posts, setPosts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Load blog posts from localStorage
    const storedPosts = localStorage.getItem('blogPosts');
    if (storedPosts) {
      setPosts(JSON.parse(storedPosts));
    } else {
      // Initialize with some sample posts
      const samplePosts = [
        {
          id: 1,
          title: "Welcome to Our Blog",
          content: "This is the first blog post. You can create, edit, and manage blog posts if you're logged in as an admin.",
          author: "Admin",
          date: new Date().toISOString(),
          published: true
        },
        {
          id: 2,
          title: "Getting Started",
          content: "Learn how to use our platform effectively. This post covers the basics of molecular visualization and analysis tools.",
          author: "Admin", 
          date: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
          published: true
        }
      ];
      setPosts(samplePosts);
      localStorage.setItem('blogPosts', JSON.stringify(samplePosts));
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
    return posts.find(post => post.id === parseInt(id));
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
