import React, { useState, useRef } from "react";
import {
  Card,
  CardBody,
  CardHeader,
  Typography,
  Button,
  Dialog,
  DialogHeader,
  DialogBody,
  DialogFooter,
  Input,
  Switch,
  IconButton,
} from "@material-tailwind/react";
import { PlusIcon, PencilIcon, TrashIcon, EyeIcon } from "@heroicons/react/24/solid";
import { useAuth } from "@/context/auth";
import { useBlog } from "@/context/blog";

export function Blog() {
  const { isAdmin, isLoggedIn } = useAuth();
  const { posts, isLoading, createPost, updatePost, deletePost, getPublishedPosts } = useBlog();
  
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingPost, setEditingPost] = useState(null);
  const [viewingPost, setViewingPost] = useState(null);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  
  const [formData, setFormData] = useState({
    title: "",
    content: "",
    published: true
  });

  const contentEditorRef = useRef(null);
  const editContentEditorRef = useRef(null);

  const displayPosts = isAdmin() ? posts : getPublishedPosts();

  // Rich text editor with paste image functionality
  const handlePaste = (event, editorRef) => {
    const items = event.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.indexOf('image') !== -1) {
        event.preventDefault();
        const file = item.getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = (e) => {
            const imageUrl = e.target.result;
            const img = document.createElement('img');
            img.src = imageUrl;
            img.style.maxWidth = '100%';
            img.style.height = 'auto';
            img.style.margin = '10px 0';
            img.style.borderRadius = '8px';
            img.style.border = '1px solid #e0e0e0';
            
            // Insert image at cursor position
            const selection = window.getSelection();
            if (selection.rangeCount > 0) {
              const range = selection.getRangeAt(0);
              range.deleteContents();
              range.insertNode(img);
              range.collapse(false);
              selection.removeAllRanges();
              selection.addRange(range);
            }
            
            // Update form data with the HTML content
            if (editorRef.current) {
              setFormData(prev => ({
                ...prev,
                content: editorRef.current.innerHTML
              }));
            }
          };
          reader.readAsDataURL(file);
        }
        break;
      }
    }
  };

  const resetForm = () => {
    setFormData({ title: "", content: "", published: true });
    if (contentEditorRef.current) {
      contentEditorRef.current.innerHTML = '';
    }
    if (editContentEditorRef.current) {
      editContentEditorRef.current.innerHTML = '';
    }
  };

  const handleCreatePost = () => {
    if (formData.title.trim() && formData.content.trim()) {
      createPost(formData);
      resetForm();
      setIsCreateDialogOpen(false);
    }
  };

  const handleEditPost = () => {
    if (formData.title.trim() && formData.content.trim() && editingPost) {
      updatePost(editingPost.id, formData);
      resetForm();
      setIsEditDialogOpen(false);
      setEditingPost(null);
    }
  };

  const handleDeletePost = (postId) => {
    if (window.confirm("Are you sure you want to delete this post?")) {
      deletePost(postId);
    }
  };

  const openEditDialog = (post) => {
    setEditingPost(post);
    setFormData({
      title: post.title,
      content: post.content,
      published: post.published
    });
    // Set content in the editor after a short delay to ensure it's rendered
    setTimeout(() => {
      if (editContentEditorRef.current) {
        editContentEditorRef.current.innerHTML = post.content;
      }
    }, 100);
    setIsEditDialogOpen(true);
  };

  const openViewDialog = (post) => {
    setViewingPost(post);
    setIsViewDialogOpen(true);
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (isLoading) {
    return (
      <div className="mt-12 mb-8 flex flex-col gap-12">
        <Card>
          <CardBody>
            <Typography variant="h6" color="blue-gray">
              Loading blog posts...
            </Typography>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="mt-12 mb-8 flex flex-col gap-12">
      <Card>
        <CardHeader variant="gradient" color="blue" className="mb-8 p-6">
          <div className="flex items-center justify-between">
            <Typography variant="h6" color="white">
              Blog Posts
            </Typography>
            {isAdmin() && (
              <Button
                variant="filled"
                color="white"
                size="sm"
                className="flex items-center gap-2"
                onClick={() => setIsCreateDialogOpen(true)}
              >
                <PlusIcon className="h-4 w-4" />
                New Post
              </Button>
            )}
          </div>
        </CardHeader>
        <CardBody className="overflow-x-scroll px-0 pt-0 pb-2">
          {displayPosts.length === 0 ? (
            <div className="p-6 text-center">
              <Typography variant="h6" color="blue-gray" className="mb-2">
                No blog posts yet
              </Typography>
              <Typography color="gray">
                {isAdmin() 
                  ? "Create your first blog post to get started." 
                  : "Check back later for new posts."}
              </Typography>
            </div>
          ) : (
            <div className="grid gap-6 p-6">
              {displayPosts.map((post) => (
                <Card key={post.id} className="border">
                  <CardBody>
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <Typography variant="h5" color="blue-gray" className="mb-2">
                          {post.title}
                        </Typography>
                        <Typography color="gray" className="text-sm mb-2">
                          By {post.author} • {formatDate(post.date)}
                          {isAdmin() && !post.published && (
                            <span className="ml-2 px-2 py-1 bg-red-100 text-red-800 text-xs rounded">
                              Draft
                            </span>
                          )}
                        </Typography>
                        <div 
                          className="prose prose-sm max-w-none mb-4"
                          dangerouslySetInnerHTML={{
                            __html: post.content.length > 300 
                              ? `${post.content.substring(0, 300)}...` 
                              : post.content
                          }}
                        />
                      </div>
                      <div className="flex gap-2 ml-4">
                        <IconButton
                          variant="text"
                          color="blue"
                          size="sm"
                          onClick={() => openViewDialog(post)}
                        >
                          <EyeIcon className="h-4 w-4" />
                        </IconButton>
                        {isAdmin() && (
                          <>
                            <IconButton
                              variant="text"
                              color="green"
                              size="sm"
                              onClick={() => openEditDialog(post)}
                            >
                              <PencilIcon className="h-4 w-4" />
                            </IconButton>
                            <IconButton
                              variant="text"
                              color="red"
                              size="sm"
                              onClick={() => handleDeletePost(post.id)}
                            >
                              <TrashIcon className="h-4 w-4" />
                            </IconButton>
                          </>
                        )}
                      </div>
                    </div>
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Create Post Dialog */}
      <Dialog open={isCreateDialogOpen} handler={setIsCreateDialogOpen} size="lg">
        <DialogHeader>Create New Blog Post</DialogHeader>
        <DialogBody divider>
          <div className="space-y-4">
            <Input
              label="Post Title"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            />
            
            {/* Rich Text Editor with Paste Image Support */}
            <div className="space-y-2">
              <Typography variant="small" color="blue-gray" className="font-medium">
                Post Content (Paste images directly with Ctrl+V)
              </Typography>
              <div
                ref={contentEditorRef}
                contentEditable
                suppressContentEditableWarning={true}
                onPaste={(e) => handlePaste(e, contentEditorRef)}
                onInput={(e) => setFormData({ ...formData, content: e.target.innerHTML })}
                className="min-h-[200px] p-3 border border-blue-gray-200 rounded-md focus:border-gray-900 focus:outline-none prose prose-sm max-w-none"
                style={{
                  fontSize: '14px',
                  lineHeight: '1.5',
                  color: '#374151'
                }}
                placeholder="Start typing your blog post... You can paste images directly here!"
              />
              <Typography variant="small" color="blue-gray" className="text-xs opacity-70">
                💡 Tip: Copy any image (from web, files, screenshots) and paste it directly in the editor with Ctrl+V
              </Typography>
            </div>
            
            <div className="flex items-center gap-2">
              <Switch
                checked={formData.published}
                onChange={(e) => setFormData({ ...formData, published: e.target.checked })}
              />
              <Typography color="blue-gray">
                Publish immediately
              </Typography>
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button
            variant="text"
            color="red"
            onClick={() => {
              setIsCreateDialogOpen(false);
              resetForm();
            }}
            className="mr-1"
          >
            Cancel
          </Button>
          <Button variant="gradient" color="green" onClick={handleCreatePost}>
            Create Post
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Edit Post Dialog */}
      <Dialog open={isEditDialogOpen} handler={setIsEditDialogOpen} size="lg">
        <DialogHeader>Edit Blog Post</DialogHeader>
        <DialogBody divider>
          <div className="space-y-4">
            <Input
              label="Post Title"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            />
            
            {/* Rich Text Editor with Paste Image Support */}
            <div className="space-y-2">
              <Typography variant="small" color="blue-gray" className="font-medium">
                Post Content (Paste images directly with Ctrl+V)
              </Typography>
              <div
                ref={editContentEditorRef}
                contentEditable
                suppressContentEditableWarning={true}
                onPaste={(e) => handlePaste(e, editContentEditorRef)}
                onInput={(e) => setFormData({ ...formData, content: e.target.innerHTML })}
                className="min-h-[200px] p-3 border border-blue-gray-200 rounded-md focus:border-gray-900 focus:outline-none prose prose-sm max-w-none"
                style={{
                  fontSize: '14px',
                  lineHeight: '1.5',
                  color: '#374151'
                }}
              />
              <Typography variant="small" color="blue-gray" className="text-xs opacity-70">
                💡 Tip: Copy any image (from web, files, screenshots) and paste it directly in the editor with Ctrl+V
              </Typography>
            </div>
            
            <div className="flex items-center gap-2">
              <Switch
                checked={formData.published}
                onChange={(e) => setFormData({ ...formData, published: e.target.checked })}
              />
              <Typography color="blue-gray">
                Published
              </Typography>
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button
            variant="text"
            color="red"
            onClick={() => {
              setIsEditDialogOpen(false);
              setEditingPost(null);
              resetForm();
            }}
            className="mr-1"
          >
            Cancel
          </Button>
          <Button variant="gradient" color="blue" onClick={handleEditPost}>
            Update Post
          </Button>
        </DialogFooter>
      </Dialog>

      {/* View Post Dialog */}
      <Dialog open={isViewDialogOpen} handler={setIsViewDialogOpen} size="lg">
        <DialogHeader>{viewingPost?.title}</DialogHeader>
        <DialogBody divider>
          <Typography color="gray" className="text-sm mb-4">
            By {viewingPost?.author} • {viewingPost && formatDate(viewingPost.date)}
          </Typography>
          <div 
            className="prose prose-sm max-w-none"
            dangerouslySetInnerHTML={{
              __html: viewingPost?.content || ''
            }}
          />
        </DialogBody>
        <DialogFooter>
          <Button
            variant="text"
            color="blue-gray"
            onClick={() => setIsViewDialogOpen(false)}
          >
            Close
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

export default Blog;
