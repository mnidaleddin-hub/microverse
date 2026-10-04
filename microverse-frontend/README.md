# Microverse Frontend

This is the frontend application for the Microverse project, built with PixiJS.

## Features

-   2D grid visualization (40x40 cells).
-   Dynamic rendering of agents (circles with gender-based colors, names, and pregnancy halos).
-   Smooth agent movement using linear interpolation.
-   Connection to the Microverse Backend via REST API for initial data and Server-Sent Events (SSE) for real-time updates.
-   Control panel for pausing/resuming simulation, adjusting speed, and resetting the world.
-   Sidebar displaying current tick, agent count, and event log.
-   Agent details popup on click, showing stats and relationships.

## Technologies

-   HTML5
-   CSS3
-   JavaScript (ES6+)
-   PixiJS v7 (loaded via CDN)

## Setup and Running Locally

1.  **Ensure Backend is Running**: This frontend connects to a deployed backend at `https://microverse-backend.onrender.com`. Make sure the backend is accessible.

2.  **Clone the Repository (if not already done)**:
    ```bash
    git clone https://github.com/mnidaleddin-hub/microverse.git
    cd microverse/microverse-frontend
    ```

3.  **Serve Statically**: Since this is a pure static HTML/CSS/JS application, you can serve it using any simple web server.

    *   **Using Python (recommended for simplicity)**:
        Navigate to the `microverse-frontend` directory in your terminal and run:
        ```bash
        python -m http.server 8000
        ```
        Then open your browser to `http://localhost:8000`.

    *   **Using Live Server VS Code Extension**: If you use VS Code, you can install the "Live Server" extension by Ritwick Dey. Right-click `index.html` and select "Open with Live Server".

## Deployment to Vercel (Drag and Drop)

1.  Go to [Vercel](https://vercel.com/) and log in.
2.  Drag and drop the entire `microverse-frontend` folder onto the Vercel dashboard.
3.  Vercel will automatically detect the project as a static site and deploy it.
4.  You will be provided with a live URL for your frontend application.
