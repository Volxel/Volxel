// Define the HTML template for the web component's Shadow DOM
const cubeTemplate = document.createElement('template');
cubeTemplate.innerHTML = `
            <style>
                /* Styles for the custom element itself, applied via :host */
                :host {
                    display: block; /* Custom elements are inline by default */
                    width: 250px; /* Base size for the 3D scene */
                    height: 250px;
                    perspective: 800px; /* Defines the strength of the 3D perspective */
                    perspective-origin: 50% 50%;
                    border: 1px solid #ddd;
                    background-color: #e8f0fe;
                    position: relative;
                    overflow: hidden; /* Ensures elements don't spill out */
                    cursor: grab;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    flex-shrink: 0; /* Prevent shrinking on smaller screens */
                }

                /* Responsive adjustments for the component itself */
                @media (min-width: 768px) {
                    :host {
                        width: 300px;
                        height: 300px;
                    }
                }

                /* Styles specific to the Shadow DOM's internal elements */
                .cube-wrapper {
                    width: 100%;
                    height: 100%;
                    position: absolute;
                    transform-style: preserve-3d;
                    transform: rotateX(-20deg) rotateY(45deg); /* Initial rotation for the entire scene */
                    display: flex;
                    justify-content: center;
                    align-items: center;
                }

                .cube {
                    width: 100px; /* Represents 1 unit in the 3D space */
                    height: 100px;
                    position: absolute;
                    transform-style: preserve-3d;
                }

                .face {
                    position: absolute;
                    width: 100px;
                    height: 100px;
                    border: 1px solid #88aadd; /* Darker blue border */
                    outline: 1px solid transparent; /* Added transparent outline for antialiasing */
                    background: rgba(135, 206, 250, 0.2); /* Light sky blue, semi-transparent */
                    box-sizing: border-box;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    font-size: 0.8em;
                    color: #666;
                    text-shadow: 0 0 2px rgba(255, 255, 255, 0.5);
                    pointer-events: none; /* Disable pointer events on faces to prevent text selection */
                    user-select: none; /* Further prevent text selection */
                }

                /* Cube face transforms */
                .front  { transform: translateZ(50px); }
                .back   { transform: rotateY(180deg) translateZ(50px); }
                .right  { transform: rotateY(90deg) translateZ(50px); }
                .left   { transform: rotateY(-90deg) translateZ(50px); }
                .top    { transform: rotateX(90deg) translateZ(50px); }
                .bottom { transform: rotateX(-90deg) translateZ(50px); }
            </style>
            <div class="cube-wrapper">
                <div class="cube">
                    <div class="face front">Front</div>
                    <div class="face back">Back</div>
                    <div class="face right">Right</div>
                    <div class="face left">Left</div>
                    <div class="face top">Top</div>
                    <div class="face bottom">Bottom</div>
                </div>
            </div>
        `;

/**
 * UnitCubeDisplay Web Component
 * Displays a 3D unit cube that can be rotated by dragging the mouse.
 * All styling and logic are encapsulated within the Shadow DOM.
 * Emits a 'direction' CustomEvent with the camera's normalized direction vector
 * whenever the cube's rotation changes.
 */
export class UnitCubeDisplay extends HTMLElement {
    private cubeWrapper: HTMLDivElement
    private rotationX: number;
    private rotationY: number;
    private isDragging: boolean;
    private lastMouseX: number;
    private lastMouseY: number;

    constructor() {
        super(); // Always call super() first in the constructor

        // Create a Shadow DOM and attach the template content
        const shadowRoot = this.attachShadow({ mode: 'open' });
        shadowRoot.appendChild(cubeTemplate.content.cloneNode(true));

        // Get references to elements inside the Shadow DOM
        this.cubeWrapper = shadowRoot.querySelector('.cube-wrapper')!;

        // Initialize rotation state
        this.rotationX = -20; // Initial X rotation in degrees
        this.rotationY = 45;  // Initial Y rotation in degrees
        this.isDragging = false;
        this.lastMouseX = 0;
        this.lastMouseY = 0;

        // Bind event handlers to the component instance
        this.handleMouseDown = this.handleMouseDown.bind(this);
        this.handleMouseMove = this.handleMouseMove.bind(this);
        this.handleMouseUp = this.handleMouseUp.bind(this);
        this.handleMouseLeave = this.handleMouseLeave.bind(this);
    }

    /**
     * Called when the custom element is first connected to the DOM.
     * This is where event listeners should be added.
     */
    connectedCallback() {
        this.addEventListener('mousedown', this.handleMouseDown);
        // Emit initial direction when component is connected
        this._dispatchDirectionEvent();
    }

    /**
     * Called when the custom element is disconnected from the DOM.
     * This is where event listeners should be removed to prevent memory leaks.
     */
    disconnectedCallback() {
        this.removeEventListener('mousedown', this.handleMouseDown);
        document.removeEventListener('mousemove', this.handleMouseMove);
        document.removeEventListener('mouseup', this.handleMouseUp);
        document.removeEventListener('mouseleave', this.handleMouseLeave);
    }


    /**
     * Getter for the current camera direction vector.
     * Calculates the normalized direction from the camera's effective position
     * to the origin of the cube, in the world coordinate system.
     * @returns {Array<number>} An array [x, y, z] representing the 3D vector.
     */
    get direction() {
        // Convert degrees to radians for trigonometric functions
        const rotationXRad = this.rotationX * (Math.PI / 180);
        const rotationYRad = this.rotationY * (Math.PI / 180);

        // Calculate the components of the normalized vector pointing FROM the origin TO the camera's effective position.
        // This assumes the camera is being rotated around the origin with pitch (rotationX) and yaw (rotationY).
        const camX_pos = Math.cos(rotationXRad) * Math.sin(rotationYRad);
        const camY_pos = Math.sin(rotationXRad);
        const camZ_pos = Math.cos(rotationXRad) * Math.cos(rotationYRad);

        // The user wants the vector FROM the camera TO the origin.
        // This is the negative of the vector from origin TO camera.
        const camVecX = -camX_pos;
        const camVecY = camY_pos;
        const camVecZ = camZ_pos;

        return [camVecX, camVecY, camVecZ];
    }

    /**
     * Setter for the cube's orientation based on a 3D direction vector.
     * The input vector should represent the desired direction from the cube's origin
     * towards the camera's effective position (matching the 'direction' event's output format).
     * @param {Array<number>} vec - An array [x, y, z] (e.g., [0, 1, 0]).
     */
    set direction(vec) {
        if (!Array.isArray(vec) || vec.length !== 3 || !vec.every(num => typeof num === 'number')) {
            console.error("Invalid vector format. Expected an array of three numbers: [x, y, z].");
            return;
        }

        const [x, y, z] = vec; // Destructure the array

        // Normalize the input vector to ensure it's a unit vector
        const magnitude = Math.sqrt(x * x + y * y + z * z);
        if (magnitude === 0) {
            console.warn("Cannot set direction with a zero vector.");
            return;
        }
        const normalizedVec = [x / magnitude, y / magnitude, z / magnitude];

        // Convert the (camera -> origin) vector to (origin -> camera) for rotation calculation
        const ox = -normalizedVec[0];
        const oy = normalizedVec[1];
        const oz = normalizedVec[2];

        // Calculate pitch (rotationX) and yaw (rotationY) from the (origin -> camera) vector
        this.rotationX = Math.asin(oy) * (180 / Math.PI);
        this.rotationY = Math.atan2(ox, oz) * (180 / Math.PI);

        // Apply the new rotation to the cube wrapper
        this.cubeWrapper.style.transform = `rotateX(${this.rotationX}deg) rotateY(${this.rotationY}deg)`;

        // Dispatch the direction event to reflect the new state immediately
        this._dispatchDirectionEvent();
    }

    /**
     * Dispatches a custom 'direction' event with the current camera direction vector.
     */
    _dispatchDirectionEvent() {
        const currentDirection = this.direction; // Get the vector from the getter
        const directionEvent = new CustomEvent('direction', {
            detail: {
                x: currentDirection[0], // Access using array index
                y: currentDirection[1], // Access using array index
                z: currentDirection[2]  // Access using array index
            },
            bubbles: true,
            composed: true
        });
        this.dispatchEvent(directionEvent);
    }

    /**
     * Handles mouse down event for scene rotation.
     * @param {MouseEvent} e - The mouse event object.
     */
    handleMouseDown(e: MouseEvent) {
        e.preventDefault()
        document.addEventListener('mousemove', this.handleMouseMove);
        document.addEventListener('mouseup', this.handleMouseUp);
        document.addEventListener('mouseleave', this.handleMouseLeave);
        this.isDragging = true;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        this.style.cursor = 'grabbing';
    }

    /**
     * Handles mouse move event for scene rotation.
     * @param {MouseEvent} e - The mouse event object.
     */
    handleMouseMove(e: MouseEvent) {
        if (!this.isDragging) return;
        const deltaX = e.clientX - this.lastMouseX;
        const deltaY = e.clientY - this.lastMouseY;

        // Adjust rotation sensitivity
        this.rotationY += deltaX * 0.5;
        this.rotationX -= deltaY * 0.5;

        // Clamp rotationX to prevent the cube from flipping upside down
        this.rotationX = Math.max(-90, Math.min(90, this.rotationX));

        // Apply the new rotation to the cube wrapper
        this.cubeWrapper.style.transform = `rotateX(${this.rotationX}deg) rotateY(${this.rotationY}deg)`;

        // Calculate and dispatch the new direction
        this._dispatchDirectionEvent();

        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
    }

    /**
     * Handles mouse up event to stop scene rotation.
     */
    handleMouseUp() {
        this.isDragging = false;
        document.removeEventListener('mousemove', this.handleMouseMove);
        document.removeEventListener('mouseup', this.handleMouseUp);
        document.removeEventListener('mouseleave', this.handleMouseLeave);
        this.style.cursor = 'grab';
    }

    /**
     * Handles mouse leave event to stop scene rotation if mouse leaves the container.
     */
    handleMouseLeave() {
        this.isDragging = false;
        document.removeEventListener('mousemove', this.handleMouseMove);
        document.removeEventListener('mouseup', this.handleMouseUp);
        document.removeEventListener('mouseleave', this.handleMouseLeave);
        this.style.cursor = 'grab';
    }
}