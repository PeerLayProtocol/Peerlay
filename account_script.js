// ACCOUNT PAGE SCRIPT

// Global Variables
let gameID;
let lastGameCalculated;
let previousRedemptions = 0;
let userPredictions = [];
let currentPage = 1;
let totalPages = 1;
let activeTabIndex = 0;
const itemsPerPage = 5;
let isOperationInProgress = false;

// Setup function to initialize shared values
async function initializeAccountPage() {
    try {
        // Fetch game and user data from the contract
        const [gameData, userData] = await Promise.all([
            contract.getGameData(),
            contract.getUserData()
        ]);

        // Extract and parse game and user data
        gameID = Number(gameData[0]);
        lastGameCalculated = Number(gameData[4]);
        userPredictions.length = Number(userData[2]);
        previousRedemptions = Number(userData[0]);

        // Calculate total pages for pagination
        totalPages = Math.ceil(userPredictions.length / itemsPerPage);

        // Update the total pages display
        const totalPagesElement = document.getElementById("totalPages");
        if (totalPagesElement) {
            totalPagesElement.textContent = totalPages;
        }

        // Hide "Redeem" buttons on initial load
        toggleButtonVisibility([".redeem-button", ".redeem-all-button"], false);
    } catch (error) {
        console.error('Error initializing account page:', error);
    }
}

function createUserPrediction(predictionID, gameID, amount, combinationID, score, prize, redeem, isRedeemable ) {
    return {
        predictionID: predictionID,
        gameID: gameID,
        amount: amount,
        combinationID: combinationID,
        score: score,
        prize: prize,
        redeem: redeem,
        isRedeemable: isRedeemable,
    };
}

// Helper function to fetch predictions' details
async function fetchPredictionsBatch(indices) {
    try {
        // Filter indices to fetch only missing predictions
        const missingIndices = indices.filter(index => !userPredictions[index]);

        // Fetch details only for the missing indices
        if (missingIndices.length === 0) return []; // No need to fetch if all predictions are already cached

        const predictionDetailsArray = await contract.getPlayerPredictions(missingIndices);

        // Process each prediction and update the `userPredictions` cache
        predictionDetailsArray.forEach((prediction, i) => {
            const combinationID = Number(prediction[0]) || 0; // Validate number
            const amount = BigInt(prediction[1]) || 0n; // Validate BigInt
            const game = Number(prediction[2]) || 0; // Validate number
            const alreadyRedeemed = Number(prediction[3]) || 0;
            const redeemed = alreadyRedeemed === 1; // Explicit comparison for BigInt
            let prize = "-";
            let score = "Not available yet";
            let isRedeemable = false;

            // Determine redeemability
            if (game === gameID) {
                isRedeemable = "withdraw";
            } else if (game <= lastGameCalculated && !redeemed) {
                isRedeemable = true;
            }

            // Calculate prize and score if the game has been calculated
            if (game <= lastGameCalculated) {
                const totalPrize = BigInt(prediction[5]) || 0n; // Validate BigInt
                const totalScores = BigInt(prediction[6]) || 0n; // Validate BigInt
                score = BigInt(prediction[4]) || 0n; // Validate BigInt
                const contributorsPrize = Number(prediction[7]) || 0;

                const rawPrize = (amount * score * totalPrize) / totalScores;
                prize = (Number(rawPrize) * (10000 - contributorsPrize)/ 1e10).toFixed(2); // Convert to a readable number
                score = (Number(score) / 1e18).toFixed(3); // Convert score to readable
            }

            userPredictions[missingIndices[i]] = createUserPrediction(
                missingIndices[i],
                game,
                Number(amount),
                combinationID,
                score,
                prize,
                redeemed,
                isRedeemable
            );
        });

        // Return only the newly fetched predictions
        return missingIndices.map(index => userPredictions[index]);
    } catch (error) {
        console.error('Error fetching batch of prediction details:', error);
        throw error;
    }
}

// Main loadPredictions function with modular approach
async function loadPredictions() {
    if (isOperationInProgress) return; // Prevent overlapping operations

    showLoading();
    try {
        // Check if the current tab is 'currentPredictions'
        if (activeTabIndex === 1) {
            // Use the new function for the 'currentPredictions' tab
            await loadPredictionsForCurrentTab();
        } else {
            isOperationInProgress = true;
            // Default logic for other tabs
            const { startIndex, endIndex } = getPaginationIndices();
            const range = Array.from({ length: startIndex - endIndex + 1 }, (_, i) => startIndex - i);

            // Fetch missing predictions
            await fetchPredictionsBatch(range);

            // Display predictions after fetching
            displayPredictions();
        }
    } catch (error) {
        console.error('Error loading predictions:', error);
    } finally {
        isOperationInProgress = false; // Release the lock
        hideLoading();
    }
}

async function loadPredictionsForCurrentTab() {
    if (isOperationInProgress) return; // Prevent overlapping operations

    isOperationInProgress = true;
    showLoading();

    try {
        let currentIndex = userPredictions.length - 1; // Start from the most recent prediction
        const batchSize = itemsPerPage; // Use the itemsPerPage constant
        let fetchedPredictions = [];
        let shouldFetchMore = true;

        // Fetch predictions in batches until a different gameID is found
        while (shouldFetchMore) {
            const range = Array.from(
                { length: Math.min(batchSize, currentIndex + 1) },
                (_, i) => currentIndex - i
            );

            // Fetch only missing predictions
            const batch = await fetchPredictionsBatch(range);

            // Add fetched predictions to the cache
            fetchedPredictions = fetchedPredictions.concat(batch);

            // Check if there are still unfetched predictions
            const unfetchedIndices = range.filter(index => !userPredictions[index]);
            if (unfetchedIndices.length === 0) {
                // All predictions in the range are already fetched, continue to next range
                currentIndex -= batchSize;
                if (currentIndex < 0) {
                    shouldFetchMore = false; // Stop when no more indices are left
                }
                continue;
            }

            // Check if the lowest-indexed predictions in this batch belong to a different game
            if (
                batch.some(prediction => prediction.gameID !== gameID) // Different gameID found
            ) {
                shouldFetchMore = false;
            } else {
                // Update the index to fetch the next batch
                currentIndex -= batchSize;
                if (currentIndex < 0) shouldFetchMore = false;
            }
        }

        // Filter the fetched predictions to include only those from the current game
        const currentGamePredictions = fetchedPredictions.filter(prediction => prediction.gameID === gameID);

        // Display predictions after filtering
        displayPredictions(currentGamePredictions);
    } catch (error) {
        console.error('Error loading current tab predictions:', error);
    } finally {
        isOperationInProgress = false; // Release the lock
        hideLoading();
    }
}

async function loadRedeemablePredictions() {
    if (isOperationInProgress) return; // Prevent concurrent operations

    isOperationInProgress = true; // Set lock
    showLoading();

    try {
        let startIndex = previousRedemptions; // Start from the last redeemed prediction
        const batchSize = itemsPerPage; // Use itemsPerPage constant
        let fetchedPredictions = [];
        let shouldFetchMore = true;

        // Fetch predictions in batches until all redeemable predictions are fetched
        while (shouldFetchMore) {
            const range = Array.from(
                { length: Math.min(batchSize, userPredictions.length - startIndex) },
                (_, i) => startIndex + i
            );

            const batch = await fetchPredictionsBatch(range);
            fetchedPredictions = fetchedPredictions.concat(batch);

            // Check for unfetched indices in the range
            const unfetchedIndices = range.filter(index => !userPredictions[index]);

            if (unfetchedIndices.length === 0) {
                // All predictions in this range are cached
                startIndex += batchSize;
                if (startIndex >= userPredictions.length) {
                    shouldFetchMore = false; // Stop when no more indices are left
                }
                continue;
            }

            // Check stopping conditions
            if (
                batch.some(prediction => prediction.gameID > lastGameCalculated) || // Future game detected
                batch.length < batchSize || // End of available predictions
                range[range.length - 1] === userPredictions.length - 1 // Last prediction reached
            ) {
                shouldFetchMore = false; // Stop fetching
            }

            startIndex += batchSize; // Move to the next batch
        }

        // Filter redeemable predictions
        const redeemablePredictions = fetchedPredictions.filter(
            prediction => prediction && (prediction.isRedeemable === true || prediction.isRedeemable === "withdraw")
        );

        // Display the filtered redeemable predictions
        displayPredictions(redeemablePredictions);
    } catch (error) {
        console.error('Error loading redeemable predictions:', error);
    } finally {
        isOperationInProgress = false; // Release lock
        hideLoading();
    }
}

// Helper function to get pagination indices
function getPaginationIndices() {
    let startIndex, endIndex;
    if (activeTabIndex === 0) {
        startIndex = userPredictions.length - 1 - (currentPage - 1) * itemsPerPage;
        endIndex = Math.max(userPredictions.length - currentPage * itemsPerPage, 0);
    } else if (activeTabIndex === 1) {
        startIndex = userPredictions.length - 1;
        endIndex = 0;
    }
    return { startIndex, endIndex };
}

// Helper function to determine action column content
function getActionColumnContent(prediction, activeTabIndex) {
    if (prediction.redeem) {
        return "Already redeemed";
    }

    if (prediction.isRedeemable === true) {
        return activeTabIndex === 2
            ? `<input type="checkbox" class="prediction-checkbox" data-prediction-id="${prediction.predictionID}">`
            : `<button class="action-btn" onclick="redeemPrediction(${prediction.predictionID})">Redeem</button>`;
    }

    if (prediction.isRedeemable === "withdraw") {
        return `<button class="action-btn" onclick="withdrawPrediction(${prediction.predictionID})">Cancel</button>`;
    }

    return "Game Unfinished";
}

// Main function to display predictions table
function displayPredictions() {
    const predictionsTableBody = document.getElementById("predictionsTable").querySelector("tbody");
    predictionsTableBody.innerHTML = ""; // Clear existing rows

    // Case 1: User is not connected
    if (!userAccount) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 6; // Adjust to match the total number of table columns
        cell.textContent = "Connect account to see your predictions.";
        cell.style.textAlign = "center"; // Center-align the message
        cell.style.fontSize = "20px"; // Increase font size
        cell.style.padding = "60px"; // Increase padding for height
        row.appendChild(cell);
        predictionsTableBody.appendChild(row);
        return;
    }

    // Determine predictions to display based on activeTabIndex
    const predictionsToDisplay = (() => {
        if (activeTabIndex === 0) {
            const { startIndex, endIndex } = getPaginationIndices();
            return userPredictions.slice(endIndex, startIndex + 1).reverse();
        }

        if (activeTabIndex === 1) {
            return userPredictions.filter(prediction => prediction && prediction.isRedeemable === "withdraw");
        }

        if (activeTabIndex === 2) {
            return userPredictions.filter(prediction => prediction && prediction.isRedeemable === true);
        }

        return [];
    })();

    // Case 2: No predictions to show
    if (predictionsToDisplay.length === 0) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 6; // Adjust to match the total number of table columns
        cell.textContent = "No predictions to show.";
        cell.style.textAlign = "center"; // Center-align the message
        cell.style.fontSize = "20px"; // Increase font size
        cell.style.padding = "60px"; // Increase padding for height
        row.appendChild(cell);
        predictionsTableBody.appendChild(row);
        return;
    }

    // Populate the table with predictions
    const fragment = document.createDocumentFragment(); // Batch DOM updates

    predictionsToDisplay.forEach(prediction => {
        const row = document.createElement("tr");

        row.innerHTML = `
            <td>${prediction.predictionID}</td>
            <td>${prediction.gameID}</td>
            <td>${prediction.amount}</td>
            <td>
                <button class="view-details-btn" onclick="openDetailsPopup(${prediction.predictionID}, ${0})">View</button>
            </td>
            <td>${prediction.prize}</td>
            <td>${getActionColumnContent(prediction, activeTabIndex)}</td>
        `;

        fragment.appendChild(row);
    });

    predictionsTableBody.appendChild(fragment); // Append all rows at once
}

// Withdraw Functions
async function withdrawPrediction(predictionID) {
    if (isOperationInProgress) return; // Prevent concurrent operations

    isOperationInProgress = true; // Set lock
    showLoading();
    try {
        // Estimate gas with ethers.js
        const gasEstimate = await contract.estimateGas.withdrawCurrentPrediction(predictionID);

        // Fetch the current gas price
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const currentGasPrice = await provider.getGasPrice();

        // Add a buffer to the gas price (e.g., 20% increase)
        const bufferedGasPrice = currentGasPrice.mul(ethers.BigNumber.from(12)).div(ethers.BigNumber.from(10));

        // Send the transaction with calculated gas options
        const tx = await contract.withdrawCurrentPrediction(predictionID, {
            gasLimit: gasEstimate,
            gasPrice: bufferedGasPrice,
        });

        // Wait for the transaction to be mined
        await tx.wait();

        // Update local state by removing the withdrawn prediction
        userPredictions[predictionID] = userPredictions[userPredictions.length - 1]; // Replace with the last prediction
        userPredictions[predictionID].predictionID = predictionID;
        userPredictions.length -= 1; // Adjust array length

        // Recalculate pagination and refresh predictions
        totalPages = Math.ceil(userPredictions.filter(prediction => prediction).length / itemsPerPage);
        if (currentPage > totalPages) currentPage = totalPages;

        displayPredictions();
    } catch (error) {
        console.error(`Error withdrawing prediction ${predictionID}:`, error);
        showCustomAlert('Failed to withdraw the prediction. Check the console for more details.', 3000);
    } finally {
        isOperationInProgress = false; // Release lock
        hideLoading();
    }
}

// Withdraw Functions
async function redeemPrediction(predictionID) {
    if (isOperationInProgress) return; // Prevent concurrent operations

    isOperationInProgress = true; // Set lock
    showLoading();
    try {
        // Initialize ethers provider and signer
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const signer = provider.getSigner();

        // Estimate gas
        const gasEstimate = await contract.estimateGas.redeemPrediction([predictionID]);

        // Fetch the current gas price and apply a buffer
        const currentGasPrice = await provider.getGasPrice();
        const bufferedGasPrice = currentGasPrice.mul(ethers.BigNumber.from(12)).div(ethers.BigNumber.from(10)); // Add 20% buffer

        // Send the transaction with estimated gas and gas price
        const tx = await contract.redeemPrediction([predictionID], {
            gasLimit: gasEstimate,
            gasPrice: bufferedGasPrice,
        });

        // Wait for the transaction to be mined
        const receipt = await tx.wait();
        console.log('Transaction mined:', receipt);

        // Update local state for the redeemed prediction
        if (userPredictions[predictionID]) {
            userPredictions[predictionID].isRedeemable = false;
            userPredictions[predictionID].redeem = true;
        }

        await loadPredictions(); // Refresh predictions
        showCustomAlert('Prediction redeemed successfully!', 3000);
    } catch (error) {
        console.error(`Error redeeming prediction ${predictionID}:`, error);
        showCustomAlert('Failed to redeem the prediction. Check the console for more details.', 3000);
    } finally {
        isOperationInProgress = false; // Release lock
        hideLoading();
    }
}

// Function to open the details modal with combination ID
async function openDetailsPopup(ID) {
    try {
        // Validate the prediction exists
        const prediction = userPredictions[ID];
        if (!prediction) {
            console.warn(`Prediction with ID ${ID} does not exist.`);
            return;
        }

        const { combinationID, gameID: correspondingGame } = prediction;

        // Fetch game data
        const gameData = await fetchGameData(correspondingGame);

        // Decode the selected options using the decodeChoiceID function
        const selectedOptions = decodeChoiceID(Number(combinationID), gameData.gameStruct);

        // Fetch event details
        const eventsData = await fetchEventsData(gameData, selectedOptions);

        // Display the fetched events in the popup
        displayPopupEvents(eventsData, selectedOptions, ID);

        // Open the modal
        openModal("detailsModal");
    } catch (error) {
        console.error('Error opening details popup:', error);
    }
}

// Helper function to fetch game data
async function fetchGameData(gameID) {
    try {
        const usedData = await contract.getGameEvents(gameID);
        return {
            gameStruct: usedData[2].map(Number), // Game structure
            gameIndexes: usedData[0].map(Number), // Event indexes
            correctSolutions: usedData[1].map(Number) // Correct solutions
        };
    } catch (error) {
        console.error(`Error fetching game data for game ID ${gameID}:`, error);
        throw error;
    }
}

// Helper function to fetch event details
async function fetchEventsData(gameData, selectedOptions) {
    try {
        const eventDetailsArray = await contract.getEvents(gameData.gameIndexes);

        return eventDetailsArray.map((eventDetails, index) => ({
            rank: gameData.gameIndexes[index],
            description: eventDetails[2], // Index 2 for description
            options: eventDetails[3], // Index 3 for options
            solution: gameData.correctSolutions[index],
            selectedOptions: selectedOptions[index] // Include selected options for clarity
        }));
    } catch (error) {
        console.error('Error fetching event details:', error);
        throw error;
    }
}

// Helper function to open a modal
function openModal(modalID) {
    const modal = document.getElementById(modalID);
    if (modal) {
        modal.style.display = "block";
    } else {
        console.warn(`Modal with ID ${modalID} not found.`);
    }
}

function displayPopupEvents(eventsData, selectedOptions, index) {
    const tableBody = document.getElementById('eventDetailsBody');
    tableBody.innerHTML = ''; // Clear existing rows
    const modalTextElement = document.getElementById("modalTypeText");

    // Display score and prize
    updateModalText(modalTextElement, userPredictions[index]);

    // Populate the table with event data
    eventsData.forEach((event, eventIndex) => {
        const row = document.createElement('tr');

        // Add description cell
        const descriptionCell = createCollapsibleCell(DOMPurify.sanitize(event.description), 100);
        row.appendChild(descriptionCell);

        // Add outcomes cell
        const outcomesCell = createOutcomesCell(
            {
                ...event, 
                options: event.options.map(option => DOMPurify.sanitize(option)) // Sanitize options here
            }, 
            selectedOptions[eventIndex]
        );        
        row.appendChild(outcomesCell);

        tableBody.appendChild(row);
    });
}

// Helper function to update modal text
function updateModalText(modalTextElement, prediction) {
    modalTextElement.innerHTML = `
        <p><strong>Score:</strong> ${prediction.score * prediction.amount}</p>
    `;
}

// Helper function to create a collapsible cell
function createCollapsibleCell(content, charLimit) {
    const cell = document.createElement('td');
    cell.textContent = content;
    cell.classList.add('collapsible');
    handleCollapsibleText(cell, charLimit); // Apply text limit with collapsibility
    return cell;
}

// Helper function to create outcomes cell
function createOutcomesCell(event, selectedOptions) {
    const cell = document.createElement('td');

    // Check if the event was skipped
    if (selectedOptions && selectedOptions[0] === 0) {
        const skippedDiv = document.createElement('div');
        skippedDiv.textContent = "Skipped";
        skippedDiv.classList.add('outcome-option'); // Add class for skipped outcomes
        cell.appendChild(skippedDiv);
    } else {
        // Add options with highlights for selected and correct ones
        event.options.forEach((option, optionIndex) => {
            const optionDiv = document.createElement('div');
            optionDiv.textContent = option;
            optionDiv.classList.add('collapsible', 'outcome-option');

            // Highlight selected options
            if (selectedOptions && selectedOptions.includes(optionIndex + 1)) {
                optionDiv.classList.add('selected');
            }

            // Highlight correct solution
            if (optionIndex + 1 === event.solution) {
                optionDiv.classList.add('right');
            }

            handleCollapsibleText(optionDiv, 50); // Limit to 50 characters
            cell.appendChild(optionDiv);
        });
    }

    return cell;
}

// Close the modal when clicking on the close button
document.querySelectorAll(".close-btn").forEach(button => {
    button.addEventListener("click", function () {
        const modal = document.getElementById("detailsModal");
        if (modal) {
            modal.style.display = "none";
        }
    });
});

// Close the modal when clicking outside the modal content
window.addEventListener("click", function (event) {
    const modal = document.getElementById("detailsModal");
    if (event.target === modal) {
        modal.style.display = "none";
    }
});

// Redeem Selected Predictions
async function redeemSelectedPredictions() {
    const selectedPredictionIDs = [];

    // Collect all checkboxes that are checked
    document.querySelectorAll(".prediction-checkbox:checked").forEach(checkbox => {
        const predictionID = parseInt(checkbox.getAttribute("data-prediction-id"));
        selectedPredictionIDs.push(predictionID);
    });

    if (selectedPredictionIDs.length === 0) {
        showCustomAlert("No predictions selected for redemption.", 3000);
        return;
    }

    try {
        // Initialize ethers provider
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const signer = provider.getSigner();

        // Estimate gas for the transaction
        const gasEstimate = await contract.estimateGas.redeemPrediction(selectedPredictionIDs);

        // Fetch the current gas price and apply a buffer
        const currentGasPrice = await provider.getGasPrice();
        const bufferedGasPrice = currentGasPrice.mul(ethers.BigNumber.from(12)).div(ethers.BigNumber.from(10)); // Add 20% buffer

        // Send the transaction with estimated gas and gas price
        const tx = await contract.redeemPrediction(selectedPredictionIDs, {
            gasLimit: gasEstimate,
            gasPrice: bufferedGasPrice,
        });

        // Wait for the transaction to be mined
        const receipt = await tx.wait();
        console.log('Transaction mined:', receipt);

        // Update the local state to mark redeemed predictions as not redeemable
        selectedPredictionIDs.forEach(predictionID => {
            if (userPredictions[predictionID]) {
                userPredictions[predictionID].isRedeemable = false;
                userPredictions[predictionID].redeem = true;
            }
        });

        // Refresh the displayed list of predictions
        displayPredictions();

        showCustomAlert("Selected predictions redeemed successfully!", 3000);
    } catch (error) {
        console.error("Error redeeming selected predictions:", error);
        showCustomAlert("Failed to redeem selected predictions. Check the console for details.", 3000);
    }
}

// Tab Switching Functions
async function showTab(tabId) {
    // Remove 'active' class from all tab buttons
    document.querySelectorAll('.tab-nav .button').forEach(button => {
        button.classList.remove('active');
    });

    // Add 'active' class to the clicked tab button
    const activeButton = document.querySelector(`.tab-nav .button[onclick="showTab('${tabId}')"]`);
    if (activeButton) {
        activeButton.classList.add('active');
    }

    // Get references to action buttons
    const redeemButton = document.querySelector(".redeem-button");
    const redeemAllButton = document.querySelector(".redeem-all-button");

    // Handle tab-specific logic
    switch (tabId) {
        case 'AllPredictions':
            activeTabIndex = 0;
            redeemButton.style.display = "none";
            redeemAllButton.style.display = "none";
            currentPage = 1;
            document.getElementById("pageNumber").textContent = currentPage;
            await loadPredictions();
            break;

        case 'currentPredictions':
            activeTabIndex = 1;
            redeemButton.style.display = "none";
            redeemAllButton.style.display = "none";
            await loadPredictions();
            break;

        case 'redeemablePredictions':
            activeTabIndex = 2;
            redeemButton.style.display = "block";
            redeemAllButton.style.display = "block";
            await loadRedeemablePredictions();
            break;

        default:
            console.warn(`Unhandled tab ID: ${tabId}`);
            return;
    }

    // Update pagination controls after loading the tab
    updatePaginationControls();
}

// Pagination Functions for Predictions
function nextPage() {
    if (currentPage < totalPages) {
        currentPage++;
        loadPredictions();
        updatePaginationControls()
        document.getElementById("pageNumber").textContent = currentPage;
    }
}

function previousPage() {
    if (currentPage > 1) {
        currentPage--;
        loadPredictions();
        updatePaginationControls()
        document.getElementById("pageNumber").textContent = currentPage;
    }
}

function updatePaginationControls() {
    const paginationControls = document.getElementById("paginationControls");
    const nextButton = document.getElementById("nextButton");
    const prevButton = document.getElementById("prevButton");

    if (activeTabIndex === 0) {
        // Show pagination controls
        paginationControls.style.display = "block";

        // Enable or disable the Previous button
        prevButton.disabled = currentPage <= 1;

        // Enable or disable the Next button
        if (totalPages === "Calculating...") {
            nextButton.disabled = true;
        } else {
            nextButton.disabled = currentPage >= totalPages;
        }
    } else {
        // Hide pagination controls
        paginationControls.style.display = "none";
    }
}

// Function to Redeem All Predictions
async function redeemAllPredictions() {
    try {
        // Collect all redeemable prediction IDs
        const redeemablePredictionIDs = userPredictions
            .filter(prediction => prediction.isRedeemable === true)
            .map(prediction => prediction.predictionID);

        if (redeemablePredictionIDs.length === 0) {
            showCustomAlert("No predictions available for redemption.", 3000);
            return;
        }

        // Initialize ethers provider and signer
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const signer = provider.getSigner();

        // Estimate gas for the transaction
        const gasEstimate = await contract.estimateGas.redeemPrediction(redeemablePredictionIDs);

        // Fetch the current gas price and apply a buffer
        const currentGasPrice = await provider.getGasPrice();
        const bufferedGasPrice = currentGasPrice.mul(ethers.BigNumber.from(12)).div(ethers.BigNumber.from(10)); // Add 20% buffer

        // Redeem all collected predictions
        const tx = await contract.redeemPrediction(redeemablePredictionIDs, {
            gasLimit: gasEstimate,
            gasPrice: bufferedGasPrice,
        });

        // Wait for the transaction to be mined
        const receipt = await tx.wait();
        console.log('Transaction mined:', receipt);

        // Update the local state to mark redeemed predictions as not redeemable
        redeemablePredictionIDs.forEach(predictionID => {
            if (userPredictions[predictionID]) {
                userPredictions[predictionID].isRedeemable = false;
                userPredictions[predictionID].redeem = true;
            }
        });

        // Refresh the displayed list of predictions
        displayPredictions();

        showCustomAlert("All redeemable predictions have been successfully redeemed!", 3000);
    } catch (error) {
        console.error("Error redeeming all predictions:", error);
        showCustomAlert("Failed to redeem all predictions. Check the console for details.", 3000);
    }
}

function decodeChoiceID(choiceId, gameStruct) {
    // Initialize the selectedChoices array for each event
    const selectedChoices = gameStruct.map(() => []);

    // Loop through each event defined in the gameStruct
    for (let i = 0; i < gameStruct.length; i++) {
        // Calculate the total number of combinations for the event
        const EventCombinations = (1 << gameStruct[i]) - 1;

        // Extract the combination for the current event
        let combination = choiceId % EventCombinations;

        // Update choiceId for the next event
        choiceId = Math.floor(choiceId / EventCombinations);

        // Decode the combination using bitwise operations
        const numOptions = gameStruct[i];
        let optionIndex = 1;

        if (combination === 0) {
            // If combination is 0, treat it as no selection
            selectedChoices[i] = [0];
        } else {
            while (combination > 0 && optionIndex <= numOptions) {
                if (combination & 1) {
                    selectedChoices[i].push(optionIndex); // Add the option to selectedChoices
                }
                combination >>= 1; // Shift to the next bit
                optionIndex++;
            }
        }
    }

    return selectedChoices; // Return the decoded choices for all events
}

// Helper function to toggle visibility of buttons
function toggleButtonVisibility(buttonSelectors, isVisible) {
    buttonSelectors.forEach(selector => {
        const button = document.querySelector(selector);
        if (button) {
            button.style.display = isVisible ? "block" : "none";
        }
    });
}

// EVENT LISTENERS
// Ensure DOM is fully loaded and initialize the default tab
document.addEventListener('DOMContentLoaded', async function () {
    await showTab('AllPredictions');
});

// Listen for wallet connection and reinitialize the account page
document.addEventListener('walletConnected', async function () {
    console.log("Wallet connected. Initializing account page...");
    await initializeAccountPage();
    await loadPredictions();
    updatePaginationControls()
});