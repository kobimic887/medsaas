// Cloudflare Pages Function to proxy API calls and bypass CORS
export async function onRequest(context) {
  const { request } = context;
  
  // Set CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
  
  // Handle preflight OPTIONS request
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }
  
  try {
    console.log('🔄 Proxying request to api.chemtest.tech');
    
    // Make the API call to the external service
    const response = await fetch('http://api.chemtest.tech', {
      method: 'GET',
      headers: {
        'User-Agent': 'Cloudflare-Pages-Function/1.0',
      },
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.text();
    console.log('✅ API proxy successful');
    
    // Return the response with CORS headers
    return new Response(JSON.stringify({
      success: true,
      data: data,
      timestamp: new Date().toISOString(),
      source: 'api.chemtest.tech',
      environment: 'cloudflare-pages'
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });
    
  } catch (error) {
    console.error('❌ API proxy error:', error.message);
    
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
      environment: 'cloudflare-pages'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });
  }
}
