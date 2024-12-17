// Global variables for reuse across functions
let gameID, gameStruct, gamePrize, currentTimestamp;
let selectedOptions = []; // Define selected options variable to use when casting predictions
let optionPercentages = Array(6).fill(null).map(() => Array(4).fill(null));
let eventsData = [];
const initialTimestamp = 1733079600;
let isOperationInProgress = false; // Prevent overlapping operations

// Setup function to initialize shared values
async function initializeGameData() {
    try {
        showLoading();
        const gameDa = await contract.getGameData();
        gameID = Number(gameDa[0]);
        document.getElementById('gameIDValue').textContent = gameID;
        gamePrize = Number(gameDa[6]) / 1000000;
        currentTimestamp = Number(gameDa[7]);

        // Update the displayed game prize
        document.getElementById('gamePrizeValue').textContent = `${gamePrize} USDC`;

        let gameData = await contract.getGameEvents(gameID);
        gameStruct = gameData[2].map(Number);
        gameIndexes = gameData[0].map(Number);

        let targetTimeStamp = initialTimestamp + ((gameID * 7) + 7) * (24 * 60 * 60);
        const remainingTime = targetTimeStamp - currentTimestamp;
        let displayElement = document.getElementById("timeDisplay");
        hideLoading();

        if (remainingTime > 0) {
            // Format remaining time
            const days = Math.floor(remainingTime / (3600 * 24));
            const hours = Math.floor((remainingTime % (3600 * 24)) / 3600);
            const minutes = Math.floor((remainingTime % 3600) / 60);
            const seconds = remainingTime % 60;

            displayElement.textContent = `Next Game in: ${days}d ${hours}h ${minutes}m ${seconds}s`;
        } else {
            // Replace message with a button to start the new game
            displayElement.innerHTML = `
                <button id="startNewGameButton" class="action-btn">
                    Start the New Game
                </button>
            `;

            // Add an event listener to the button
            const startNewGameButton = document.getElementById("startNewGameButton");
            startNewGameButton.addEventListener("click", async () => {
                try {
                    showLoading();

                    // Estimate gas for the transaction
                    const gasEstimate = await contract.estimateGas.advancePhase();

                    // Fetch the current gas price
                    const provider = new ethers.providers.Web3Provider(window.ethereum);
                    const currentGasPrice = await provider.getGasPrice();

                    // Add a buffer to gas limit and gas price (20% buffer)
                    const bufferedGasLimit = gasEstimate.mul(ethers.BigNumber.from(12)).div(ethers.BigNumber.from(10));
                    const bufferedGasPrice = currentGasPrice.mul(ethers.BigNumber.from(12)).div(ethers.BigNumber.from(10));

                    // Send the transaction with buffered gas settings
                    const tx = await contract.advancePhase({
                        gasLimit: bufferedGasLimit,
                        gasPrice: bufferedGasPrice,
                    });

                    await tx.wait(); // Wait for the transaction to be mined
                    console.log("New game started successfully");

                    showCustomAlert("New game started successfully!", 3000);
                } catch (error) {
                    console.error("Error starting the new game:", error);
                    showCustomAlert(
                        "Failed to start the new game. Refresh your page or connect your account and try again.",
                        5000
                    );
                } finally {
                    hideLoading();
                }
            });
        }

        optionPercentages = await contract.getOptionPercentages(gameID);

        // Ensure each percentage is a number and divided by 10
        optionPercentages = optionPercentages.map(row => row.map(value => Number(value) / 10));

        // Initialize selectedOptions as an array of empty arrays (indicating no selection initially)
        selectedOptions = Array.from({ length: gameStruct.length }, () => []);

        return selectedOptions;
    } catch (error) {
        console.error('Error initializing game data:', error);
    }
}

// Loading the main table for game events
async function loadGameEvents() {
    try {
        showLoading();
        // Fetch all event details at once
        const eventDetailsArray = await contract.getEvents(gameIndexes);

        // Transform the data into a suitable format for display
        eventsData = eventDetailsArray.map((eventDetails, index) => ({
            rank: gameIndexes[index],
            description: eventDetails.description, // Assuming `description` is a string
            options: eventDetails.options, // Assuming `options` is an array
        }));

        displayGameEvents(eventsData, optionPercentages);
        hideLoading();
    } catch (error) {
        console.error('Error loading game events:', error);
    }
}


function displayGameEvents(eventsData, optionPercentages) {
    const tableBody = document.getElementById('topVotedEventsBody');
    const showPercentages = document.getElementById('togglePercentages').checked;
    tableBody.innerHTML = ''; // Clear existing rows

    eventsData.forEach((event, eventIndex) => {
        const row = document.createElement('tr');
        
        // Description column with collapsibility
        const descriptionCell = document.createElement('td');
        const sanitizedDescription = DOMPurify.sanitize(event.description);
        descriptionCell.textContent = sanitizedDescription; // Use sanitized description
        
        // Apply collapsible functionality if description exceeds 200 characters
        if (sanitizedDescription.length > 200) {
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
                const sanitizedOption = DOMPurify.sanitize(option);
                const percentage = showPercentages && optionIndex > 0 
                    ? ` (${optionPercentages[eventIndex]?.[optionIndex - 1] || 0}%)` 
                    : '';
                optionCell.textContent = `${sanitizedOption}${percentage}`;
                optionCell.classList.add('outcome-option', 'selectable');
            }

            optionCell.dataset.eventId = eventIndex;
            optionCell.dataset.optionIndex = optionIndex;
            optionCell.dataset.totalOptions = event.options.length;

            if (event.options.length === 3) { // +1 accounts for "Skip Event" being added as null
                outcomesCell.classList.add('three-options');
            }

            optionCell.addEventListener('click', () => handleOptionClick(optionCell));

            // Apply collapsibility to options if the text length exceeds 40 characters
            if (option && option.length > 40) {
                handleCollapsibleText(optionCell, 40);
            }

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

async function castPrediction() {
    if (isOperationInProgress) return; // Block if operation is in progress

    // Check if the wallet is connected
    if (!userAccount || typeof userAccount === 'undefined') {
        showCustomAlert('Please connect your wallet to cast a prediction.', 3000);
        return;
    }

    isOperationInProgress = true;

    try {
        showLoading();

        const predictionAmountElem = document.getElementById('usdc_num');
        const predictionAmount = Number(predictionAmountElem.value);

        if (isNaN(predictionAmount) || predictionAmount <= 0) {
            showCustomAlert('Please enter a valid amount of USDC.', 3000);
            return;
        }

        for (let i = 0; i < selectedOptions.length; i++) {
            const selectedOptionsForEvent = selectedOptions[i];
            const totalOptions = gameStruct[i];

            if (selectedOptionsForEvent.length === 0) {
                showCustomAlert(`Please select at least one option for event ${i + 1}.`, 3000);
                return;
            }

            if (selectedOptionsForEvent.length > totalOptions - 1) {
                showCustomAlert(`For event ${i + 1}, you can select up to ${totalOptions - 1} options.`, 3000);
                return;
            }
        }

        const choiceID = getChoiceID(selectedOptions, gameStruct);

        // Check and update allowance if necessary
        if (usdcAllowance < predictionAmount * 1e6) {
            await setDynamicAllowance(predictionAmount * 1e6);
        }

        // Estimate gas for the transaction
        const gasEstimate = await contract.estimateGas.castPrediction(choiceID, predictionAmount, gameID);

        // Fetch the current gas price
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const currentGasPrice = await provider.getGasPrice();

        // Add a buffer to gas limit and gas price (20% buffer)
        const bufferedGasLimit = gasEstimate.mul(ethers.BigNumber.from(12)).div(ethers.BigNumber.from(10));
        const bufferedGasPrice = currentGasPrice.mul(ethers.BigNumber.from(12)).div(ethers.BigNumber.from(10));

        // Send the transaction with buffered gas settings
        const tx = await contract.castPrediction(choiceID, predictionAmount, gameID, {
            gasLimit: bufferedGasLimit,
            gasPrice: bufferedGasPrice,
        });

        await tx.wait(); // Wait for the transaction to be mined
        console.log("Prediction cast successfully");

        showCustomAlert("Prediction cast successfully! Find it in your Account section.", 3000);

        // Reset selection
        selectedOptions = Array.from({ length: selectedOptions.length }, () => []);
        const optionCells = document.querySelectorAll('.outcomes-cell .selected');
        optionCells.forEach(option => option.classList.remove('selected'));
        predictionAmountElem.value = '';
    } catch (error) {
        console.error('Error casting prediction:', error);
        showCustomAlert('Failed to cast the prediction. Check the console for more details.', 3000);
    } finally {
        isOperationInProgress = false; // Release lock
        hideLoading();
    }
}

// Global keydown listener to send a prediction when pressing Enter
document.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        castPrediction();
    }
});

document.addEventListener('contractsInitialized', async function () {
    await initializeGameData();
    await loadGameEvents();

    document.getElementById('placePrediction_btn').addEventListener('click', castPrediction);

    document.getElementById('togglePercentages').addEventListener('change', function() {
        displayGameEvents(eventsData, optionPercentages);
    });
});

function getChoiceID(selectedOptions, gameStruct) {
    let choiceId = 0;
    let base = 1;

    for (let i = 0; i < gameStruct.length; i++) {
        let combinationId = 0;

        // Handle selection, including 0 as a valid option
        if (selectedOptions[i].length === 0) {
            combinationId = 0; // Represents "no selection" or "skip"
        } else {
            selectedOptions[i].forEach(option => {
                if (option === 0) {
                    combinationId = 0; // Explicitly handle "0" as a valid option
                } else {
                    combinationId |= (1 << (option - 1)); // Set the appropriate bit for other options
                }
            });
        }

        // Add the current combination to the choiceId
        choiceId += combinationId * base;

        // Update the base multiplier for the next event
        base *= (1 << gameStruct[i]) - 1; // Equivalent to 2^gameStruct[i] - 1
    }

    return choiceId;
}