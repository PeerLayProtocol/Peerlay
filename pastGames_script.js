// Global variables for reuse across functions
let gameID;
let lastGameCalculated;
let gameSelected;
let gameStruct = [];
let gameSolutions = [];
let selectedOptions = [];
let optionPercentages = Array(6).fill(null).map(() => Array(4).fill(null));
let eventsData = [];
let isOperationInProgress = false; // Prevent overlapping operations
let scoresSum = 0;
let gamePrize = 0;

// Setup function to initialize shared values
async function initializeGameData() {
    try {
        showLoading();
        const gameData = await contract.getGameData();
        gameID = Number(gameData[0]);
        gameSelected = gameID - 1;
        currentGameLabel.textContent = `Game ${gameSelected}`;
        lastGameCalculated = Number(gameData[4]);
        hideLoading();
        loadGameEvents()
    } catch (error) {
        console.error('Error initializing game data:', error);
    }
}

// Loading the main table for game events
async function loadGameEvents() {
    try {
        showLoading();
        let selectedGameData = await contract.getGameEvents(gameSelected);
        gameStruct = selectedGameData[2].map(Number);
        gameIndexes = selectedGameData[0].map(Number);

        if (gameSelected <= lastGameCalculated) {
            gameSolutions = selectedGameData[1].map(Number);
        }

        optionPercentages = await contract.getGamePercentages(gameSelected);

        gamePrizeData = await contract.getGamePrize(gameSelected);

        scoresSum = Number(gamePrizeData[1]) / 1e18;
        gamePrize = Number(gamePrizeData[0]) / 1e6;

        // Ensure each percentage is a number and divided by 10
        optionPercentages = optionPercentages.map(row => row.map(value => Number(value) / 10));

        // Sanitize data before adding to eventsData
        const eventDetailsArray = await contract.getEvents(gameIndexes);
        eventsData = eventDetailsArray.map((eventDetails, index) => ({
            rank: gameIndexes[index],
            description: DOMPurify.sanitize(eventDetails.description),
            options: eventDetails.options.map(option => DOMPurify.sanitize(option)),
            solution: gameSelected <= lastGameCalculated ? gameSolutions[index] : null
        }));

        displayGameEvents(eventsData);
        updateSeeResultsButtonVisibility();
        hideLoading();
    } catch (error) {
        console.error('Error loading game events:', error);
    }
}

function displayGameEvents(eventsData) {
    const tableBody = document.getElementById('topVotedEventsBody');
    tableBody.innerHTML = ''; // Clear existing rows

    eventsData.forEach((event, eventIndex) => {
        const row = document.createElement('tr');

        // Description column with collapsibility
        const descriptionCell = document.createElement('td');
        descriptionCell.textContent = event.description; // Already sanitized in loadGameEvents
        if (event.description.length > 200) {
            handleCollapsibleText(descriptionCell, 200);
        }
        row.appendChild(descriptionCell);

        // Outcomes column with "Skip Event" and other options
        const outcomesCell = document.createElement('td');
        outcomesCell.classList.add('outcomes-cell');

        [null, ...event.options].forEach((option, optionIndex) => {
            const optionCell = document.createElement('div');
            if (optionIndex === 0) {
                optionCell.textContent = 'Skip Event';
                optionCell.classList.add('skip-option');
            } else {
                const percentage = ` (${optionPercentages[eventIndex]?.[optionIndex - 1] || 0}%)`;
                optionCell.textContent = `${option || ''}${percentage}`;
                optionCell.classList.add('outcome-option', 'selectable');

                // Add 'right' class if this option is the correct solution
                if (event.solution && optionIndex === event.solution) {
                    optionCell.classList.add('right');
                }
            }

            optionCell.dataset.eventId = eventIndex;
            optionCell.dataset.optionIndex = optionIndex;
            optionCell.dataset.totalOptions = event.options.length;

            if (event.options.length === 3) {
                outcomesCell.classList.add('three-options');
            }

            if (option && option.length > 40) {
                handleCollapsibleText(optionCell, 40);
            }

            // Add event listener for secure option handling
            optionCell.addEventListener('click', () => handleOptionClick(optionCell));

            outcomesCell.appendChild(optionCell);
        });

        row.appendChild(outcomesCell);
        tableBody.appendChild(row);
    });
}

function handleOptionClick(optionCell) {
    const eventId = Number(optionCell.dataset.eventId);
    const optionIndex = Number(optionCell.dataset.optionIndex);
    const totalOptions = Number(optionCell.dataset.totalOptions);

    selectedOptions[eventId] = selectedOptions[eventId] || [];
    const selectedOptionsForEvent = selectedOptions[eventId];
    const isSkipEvent = optionIndex === 0;

    // Handle "Skip Event" selection
    if (isSkipEvent) {
        selectedOptions[eventId] = [0];
        document.querySelectorAll(`[data-event-id='${eventId}']`).forEach(option => option.classList.remove('selected'));
        optionCell.classList.add('selected');
        return;
    }

    // Special case: only 2 options (plus Skip)
    if (totalOptions === 2) {
        if (selectedOptionsForEvent.includes(optionIndex)) {
            // Deselect the clicked option
            selectedOptions[eventId] = [];
            optionCell.classList.remove('selected');
        } else {
            // Select the clicked option and replace the previous one
            selectedOptions[eventId] = [optionIndex];
            document.querySelectorAll(`[data-event-id='${eventId}']`).forEach(option => option.classList.remove('selected'));
            optionCell.classList.add('selected');
        }
        return;
    }

    // Handle normal option selection
    const selectedIndex = selectedOptionsForEvent.indexOf(optionIndex);
    if (selectedOptionsForEvent.includes(0)) {
        // Remove "Skip Event" if any other option is selected
        selectedOptions[eventId] = [optionIndex];
        document.querySelector(`[data-event-id='${eventId}'][data-option-index='0']`).classList.remove('selected');
        optionCell.classList.add('selected');
        return;
    }

    if (selectedIndex > -1) {
        // Deselect the clicked option
        selectedOptions[eventId].splice(selectedIndex, 1);
        optionCell.classList.remove('selected');
    } else if (selectedOptionsForEvent.length < totalOptions - 1) {
        // Select the clicked option if within limit
        selectedOptions[eventId].push(optionIndex);
        optionCell.classList.add('selected');
        document.querySelector(`[data-event-id='${eventId}'][data-option-index='0']`).classList.remove('selected');
    } else {
        // Exceeded selection limit
        showCustomAlert(`You can only select up to ${totalOptions - 1} options for this event.`, 3000);
    }

    // Allow empty selection (no auto-revert to "Skip Event")
    if (selectedOptions[eventId].length === 0) {
        selectedOptions[eventId] = []; // Explicitly allow empty array
    }

    // Sort the selected options for consistent order
    selectedOptions[eventId].sort((a, b) => a - b);
}

function calculateSingleScore(selectedOptions) {
    let score = 1; // Start with the initial score (10^18)

    // Loop through each event to calculate the score adjustments
    for (let j = 0; j < gameStruct.length; j++) {
        const eventOptions = selectedOptions[j] || []; // Options selected for the event
        const finalSolution = gameSolutions[j]; // Final solution for the event

        if ((eventOptions.length === 1 && eventOptions[0] === 0) || finalSolution === 0) {
            // Skip this event if no options are selected or no solution exists
            continue;
        }

        let multipliersSum = 0; // Sum of multipliers for selected options
        let solutionIncluded = false; // Tracks if the final solution is included in the selected options

        // Calculate the sum of multipliers and check if the solution is included
        eventOptions.forEach(option => {
            if (option === finalSolution) {
                solutionIncluded = true;
            }
            multipliersSum += optionPercentages[j][option - 1]; // Adjust for 1-based indexing
        });

        // Adjust the score based on whether the solution is included
        if (solutionIncluded) {
            score = (score * (100)) / (multipliersSum);
        } else {
            score = (score * (100 - multipliersSum)) / (100);
        }
    }

    let prize = (score / scoresSum) * gamePrize

    // Divide the final score by 1e18 to convert it into a readable number
    return prize;
}

function updateSeeResultsButtonVisibility() {
    const seeResultsButton = document.getElementById("seeResults_btn");
    if (gameSelected > lastGameCalculated) {
        seeResultsButton.style.display = "none"; // Hide the button
    } else {
        seeResultsButton.style.display = "block"; // Show the button
    }
    const scoreDisplayElement = document.getElementById("scoreDisplay");
    scoreDisplayElement.textContent = ``;
}

// Add event listeners for navigation buttons
document.addEventListener('DOMContentLoaded', () => {
    const previousGameButton = document.getElementById('previousGameButton');
    const nextGameButton = document.getElementById('nextGameButton');
    const currentGameLabel = document.getElementById('currentGameLabel');

    // Update buttons' state and label
    function updateNavigationButtons() {
        currentGameLabel.textContent = `Game ${gameSelected}`;
        previousGameButton.disabled = gameSelected === 1;
        nextGameButton.disabled = gameSelected >= gameID - 1;
    }

    // Handle Previous Game Button Click
    previousGameButton.addEventListener('click', async () => {
        if (gameSelected > 0) {
            gameSelected--;
            updateNavigationButtons();
            await loadGameEvents();
        }
    });

    // Handle Next Game Button Click
    nextGameButton.addEventListener('click', async () => {
        if (gameSelected < gameID - 1) {
            gameSelected++;
            updateNavigationButtons();
            await loadGameEvents();
        }
    });

    // Initialize navigation state after data is loaded
    document.addEventListener('contractsInitialized', () => {
        updateNavigationButtons();
    });
});


document.addEventListener('contractsInitialized', async function () {
    await initializeGameData();
});

document.getElementById("seeResults_btn").addEventListener("click", () => {
    try {
        // Validate if required data is available
        if (!selectedOptions || selectedOptions.length === 0) {
            showCustomAlert("No options selected. Please make your choices before viewing results.", 3000);
            return;
        }

        // Validate that there is a selection for every event
        for (let i = 0; i < gameStruct.length; i++) {
            if (!selectedOptions[i] || selectedOptions[i].length === 0) {
                showCustomAlert(`You must select an option for Event ${i + 1}, even if it's "Skip Event".`,3000);
                return;
            }
        }

        // Call the score calculation function with the selected options
        const score = calculateSingleScore(selectedOptions);

        // Display the score in the designated HTML element
        const scoreDisplayElement = document.getElementById("scoreDisplay");
        if (scoreDisplayElement) {
            const formattedScore = (Math.round(score * 1000) / 1000).toLocaleString(undefined, {
                minimumFractionDigits: 0,
                maximumFractionDigits: 3,
            });
            scoreDisplayElement.textContent = `Casting 1 USDC on this prediction would have returned ${formattedScore} USDCs`;
        } else {
            console.warn("Score display element not found.");
        }


    } catch (error) {
        console.error("Error calculating score:", error);
        showCustomAlert("An error occurred while calculating your score. Please try again.", 3000);
    }
});