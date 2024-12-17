// TOP-LEVEL VARIABLES
let contract, fusdContract; // Contracts for the main contract, FakeUSDC, and PlatformToken
let userAccount;
let isContractsInitialized = false; // Flag to track initialization
let usdcAllowance = 0;

// Replace these addresses with the actual deployed contract addresses
const contractAddress = '0x0737a6DFF3BbC6c574f8714b4c4Eb5Cc0992Af76';  // Main contract
const fusdAddress = '0x1097baA7e3017241D94062b4949C3b62A6bBc62D';  // FakeUSDC contract address

// Target network details (Polygon Mainnet)
const TARGET_CHAIN_ID = '0x89'; // Hexadecimal for 137 (Polygon Mainnet)
const NETWORK_NAME = 'Polygon Mainnet';

// Fallback Polygon Node URL (Free Public Endpoint)
const POLYGON_NODE_URL = 'https://rpc.ankr.com/polygon';  // Use a free public endpoint like from QuickNode or Moralis

// COMMON FUNCTIONS FOR ALL PAGES
async function loadABI(file) {
    try {
        const response = await fetch(file); // Fetch ABI from the specified local file
        const abi = await response.json();
        return abi;
    } catch (error) {
        console.error(`Error loading ABI from ${file}:`, error);
    }
}

// Initialize Web3 and the contracts
async function initContracts(useFallback = false) {
    if (isContractsInitialized) {
        console.log('Contracts already initialized.');
        return; // Prevent multiple initializations
    }

    // Load the ABIs
    const abiContract = await loadABI('abi_contract.json');
    const abiFUSD = await loadABI('abi_fusd.json');

    let provider, signer;
    if (useFallback || !window.ethereum) {
        console.log('Using fallback Polygon node...');
        provider = new ethers.providers.JsonRpcProvider(POLYGON_NODE_URL);
    } else {
        provider = new ethers.providers.Web3Provider(window.ethereum);
        const accounts = await provider.listAccounts(); // Fetch connected accounts

        if (accounts.length > 0) {
            signer = provider.getSigner(); // Use signer if accounts exist
        } else {
            console.warn('No wallet account connected. Using fallback provider for readonly operations.');
            useFallback = true;
            provider = new ethers.providers.JsonRpcProvider(POLYGON_NODE_URL);
        }
    }

    // Initialize the contracts
    contract = signer
        ? new ethers.Contract(contractAddress, abiContract, signer) // Full access with signer
        : new ethers.Contract(contractAddress, abiContract, provider); // Readonly access
    fusdContract = signer
        ? new ethers.Contract(fusdAddress, abiFUSD, signer)
        : new ethers.Contract(fusdAddress, abiFUSD, provider);

    console.log('Main contract initialized:', contract);
    console.log('FakeUSDC contract initialized:', fusdContract);

    isContractsInitialized = true; // Mark as initialized
    document.dispatchEvent(new Event('contractsInitialized'));
}

// Function to check if the wallet is on the correct network
async function checkNetwork() {
    try {
        if (!window.ethereum) {
            showCustomAlert('No Ethereum-compatible wallet found.', 3000);
            return false;
        }

        const chainId = await window.ethereum.request({ method: 'eth_chainId' });
        if (chainId === TARGET_CHAIN_ID) {
            console.log(`Connected to the correct network: ${NETWORK_NAME}`);
            return true;
        } else {
            console.warn(`Incorrect network. Expected: ${NETWORK_NAME}, but got chain ID: ${chainId}`);
            return false;
        }
    } catch (error) {
        console.error('Error checking network:', error);
        return false;
    }
}

// Function to request a network switch
async function switchNetwork() {
    try {
        await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: TARGET_CHAIN_ID }],
        });
        console.log(`Successfully switched to ${NETWORK_NAME}`);
        return true;
    } catch (error) {
        if (error.code === 4902) {
            showCustomAlert(`${NETWORK_NAME} is not available in your wallet. Please add it manually.`, 3000);
        } else {
            console.error('Error switching network:', error);
        }
        return false;
    }
}

// Ensure the wallet is on the correct network
async function ensureCorrectNetwork() {
    const isCorrectNetwork = await checkNetwork();
    if (!isCorrectNetwork) {
        console.log('Switching to the correct network...');
        const switched = await switchNetwork();
        if (!switched) {
            showCustomAlert(`Please manually switch to ${NETWORK_NAME} in your wallet.`, 3000);
        }
    }
}

// Connect the wallet and check the network
async function connectWallet() {
    const connectedAccount = sessionStorage.getItem('connectedAccount');

    if (connectedAccount) {
        const confirmDisconnect = confirm('You are already connected. Do you want to disconnect?');
        if (confirmDisconnect) {
            sessionStorage.removeItem('connectedAccount');
            userAccount = null;

            // Update the button text
            const walletButton = document.getElementById('connectWallet');
            walletButton.textContent = ''; // Clear previous content

            const walletIcon = document.createElement('img');
            walletIcon.src = 'favicons/wallet-icon.png';
            walletIcon.alt = 'Wallet Icon';
            walletIcon.classList.add('wallet-icon');

            const buttonText = document.createTextNode('Connect Wallet');
            walletButton.appendChild(walletIcon);
            walletButton.appendChild(buttonText);

            console.log('Disconnected from Web3 wallet.');
            return;
        }
    } else {
        if (window.ethereum) {
            try {
                const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
                userAccount = accounts[0];
                console.log('Connected account:', userAccount);

                sessionStorage.setItem('connectedAccount', userAccount);

                // Update the button text
                const walletButton = document.getElementById('connectWallet');
                walletButton.textContent = ''; // Clear previous content

                const walletIcon = document.createElement('img');
                walletIcon.src = 'favicons/wallet-icon.png';
                walletIcon.alt = 'Wallet Icon';
                walletIcon.classList.add('wallet-icon');

                const shortenedAccount = `${userAccount.slice(0, 6)}...${userAccount.slice(-4)}`;
                const accountText = document.createTextNode(shortenedAccount);

                walletButton.appendChild(walletIcon);
                walletButton.appendChild(accountText);

                await ensureCorrectNetwork(); // Ensure correct network
                await initContracts(); // Initialize contracts after wallet connection
                document.dispatchEvent(new Event('walletConnected'));
            } catch (error) {
                if (error.code === 4001) { // User rejected the connection
                    console.warn('User denied wallet connection.');
                } else {
                    console.error('Error connecting to Web3 wallet:', error);
                }
                showCustomAlert('Failed to connect to Web3 wallet.', 3000);
            }
        } else {
            showCustomAlert('Web3 wallet is not installed. Please install MetaMask and try again.', 3000);
        }
    }
}

async function checkConnectedAccount() {
    const connectedAccount = sessionStorage.getItem('connectedAccount');

    if (connectedAccount) {
        console.log('Connected account found:', connectedAccount);
        userAccount = connectedAccount;

        // Ensure contracts are initialized
        if (!isContractsInitialized) {
            await initContracts();
        }

        // Shorten the connected account address
        const shortenedAccount = `${connectedAccount.slice(0, 6)}...${connectedAccount.slice(-4)}`;

        // Update the button UI with the wallet icon and shortened address
        const walletButton = document.getElementById('connectWallet');
        walletButton.textContent = ''; // Clear previous content

        const walletIcon = document.createElement('img');
        walletIcon.src = 'favicons/wallet-icon.png';
        walletIcon.alt = 'Wallet Icon';
        walletIcon.classList.add('wallet-icon');

        const accountText = document.createTextNode(shortenedAccount);
        walletButton.appendChild(walletIcon);
        walletButton.appendChild(accountText);

        // Dispatch the 'walletConnected' event since the account is found
        document.dispatchEvent(new Event('walletConnected'));
    } else {
        console.log('No connected account found.');
    }
}

async function setDynamicAllowance(allowance) {
    try {
        // Estimate the gas required for the transaction
        const gasEstimate = await fusdContract.estimateGas.approve(contractAddress, allowance.toString());

        // Fetch the current gas price
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const currentGasPrice = await provider.getGasPrice();

        // Add a buffer to gas limit and gas price (default 20% buffer)
        const gasBufferFactor = ethers.BigNumber.from(12).div(ethers.BigNumber.from(10)); // 1.2x buffer
        const bufferedGasLimit = gasEstimate.mul(gasBufferFactor);
        const bufferedGasPrice = currentGasPrice.mul(gasBufferFactor);

        // Send the transaction with calculated gas options
        const tx = await fusdContract.approve(contractAddress, allowance.toString(), {
            gasLimit: bufferedGasLimit,
            gasPrice: bufferedGasPrice,
        });

        // Wait for the transaction to be mined
        await tx.wait();

        // Update `usdcAllowance` after successful transaction
        usdcAllowance = allowance;
        console.log(`Dynamic allowance updated: ${usdcAllowance}`);
    } catch (error) {
        console.error(`Error setting dynamic allowance:`, error);
        throw error; // Re-throw to handle errors where this function is called
    }
}

// Check and set allowances for required tokens
async function checkAllowance() {
    try {
        // Fetch allowance as a BigNumber
        const allowanceBigNumber = await fusdContract.allowance(userAccount, contractAddress);

        // Convert BigNumber to a number
        usdcAllowance = Number(allowanceBigNumber.toString());
        console.log(`USDC Allowance: ${usdcAllowance}`);
    } catch (error) {
        console.error("Error checking or setting allowances:", error);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    if (window.ethereum) {
        console.log("Ethereum wallet detected.");

        // Add event listener for network changes
        window.ethereum.on('chainChanged', (chainId) => {
            console.log('Network changed to:', chainId);
            if (chainId !== TARGET_CHAIN_ID) {
                showCustomAlert(`You switched to an unsupported network. Please switch back to ${NETWORK_NAME}.`, 3000);
            } else {
                console.log(`You are now connected to ${NETWORK_NAME}.`);
            }
        });

        try {
            // Check if any wallet accounts are already connected
            const accounts = await window.ethereum.request({ method: 'eth_accounts' });

            if (accounts.length > 0) {
                console.log('Wallet connected:', accounts[0]);
                userAccount = accounts[0];
                await ensureCorrectNetwork(); // Ensure correct network
                await initContracts(); // Use wallet provider with signer
                await checkConnectedAccount(); // Restore session if available
            } else {
                console.log('No wallet account connected. Falling back to public node...');
                await initContracts(true); // Use the fallback node
            }
        } catch (error) {
            console.warn('Error checking wallet accounts. Falling back to node...', error);
            await initContracts(true); // Use the fallback node
        }
    } else {
        console.log("Ethereum wallet not detected. Using fallback node.");
        await initContracts(true); // Use the fallback node
    }
});

document.getElementById('connectWallet').addEventListener('click', async () => {
    await connectWallet();
});

document.addEventListener('walletConnected', async () => {
    console.log('Wallet connected event triggered');
    await checkAllowance();
});


function handleCollapsibleText(element, charLimit) {
    const content = element.textContent.trim();
    
    // Only apply collapsibility if content length exceeds the character limit
    if (content.length <= charLimit) return;

    // Create the visible and hidden text parts
    const visibleText = content.slice(0, charLimit);
    const extraText = content.slice(charLimit);

    const visibleSpan = document.createElement('span');
    visibleSpan.className = 'visible-text';
    visibleSpan.textContent = visibleText;

    const extraSpan = document.createElement('span');
    extraSpan.className = 'extra-text';
    extraSpan.textContent = extraText;
    extraSpan.style.display = 'none';  // Initially hidden

    const seeMoreLink = document.createElement('span');
    seeMoreLink.className = 'see-more-link';
    seeMoreLink.textContent = ' See more';
    seeMoreLink.style.color = 'blue';
    seeMoreLink.style.cursor = 'pointer';

    // Append structured content to the element
    element.innerHTML = '';
    element.classList.add('collapsible');  // Apply collapsible styling
    element.appendChild(visibleSpan);
    element.appendChild(extraSpan);
    element.appendChild(seeMoreLink);

    // Toggle expand/collapse on "See more" click
    seeMoreLink.addEventListener('click', function () {
        const isExpanded = element.classList.toggle('expand');
        extraSpan.style.display = isExpanded ? 'inline' : 'none';
        seeMoreLink.textContent = isExpanded ? ' See less' : ' See more';
    });
}

function showLoading() {
    const loadingElement = document.getElementById('loadingIndicator');
    loadingElement.style.display = 'block';
}

function hideLoading() {
    const loadingElement = document.getElementById('loadingIndicator');
    loadingElement.style.display = 'none';
}

const menuOpenButton = document.querySelector("#menu-open-button");
menuOpenButton.addEventListener("click", () => {
    document.body.classList.toggle("show-mobile-menu")
});

const menuCloseButton = document.querySelector("#menu-close-button");
menuCloseButton.addEventListener("click", () => menuOpenButton.click())

// Function to show the custom alert with auto-close feature
function showCustomAlert(message) {
    const alertElement = document.querySelector('.custom-alert');
    const alertContent = document.querySelector('.custom-alert-content');

    // Set the alert message
    alertContent.textContent = message;

    // Dynamically calculate and set `top` for the alert (120px from the top)
    const scrollOffset = window.scrollY; // Get the current vertical scroll position
    alertElement.style.top = `${scrollOffset + 30}px`;
    alertElement.style.left = '50%'; // Center horizontally
    alertElement.style.transform = 'translateX(-50%)'; // Adjust for exact horizontal centering

    // Show the alert
    alertElement.style.display = 'block';

    // Automatically hide the alert after 3 seconds
    setTimeout(() => {
        alertElement.style.display = 'none';
    }, 3000);
}
