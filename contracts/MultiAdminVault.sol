// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MultiAdminVault {
    struct Proposal {
        address proposer;
        address target;
        uint256 value;
        bytes data;
        string description;
        uint256 approvalCount;
        bool executed;
        uint256 createdAt;
    }

    address[] private s_admins;
    mapping(address => bool) public isAdmin;
    mapping(uint256 => Proposal) private s_proposals;
    mapping(uint256 => mapping(address => bool)) private s_hasApproved;

    uint256 public immutable threshold;
    uint256 public proposalCount;

    event VaultInitialized(address[] admins, uint256 threshold);
    event Deposit(address indexed sender, uint256 amount, uint256 balance);
    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        address indexed target,
        uint256 value,
        bytes data,
        string description
    );
    event ProposalApproved(
        uint256 indexed proposalId,
        address indexed admin,
        uint256 approvalCount,
        uint256 threshold
    );
    event ProposalExecuted(
        uint256 indexed proposalId,
        address indexed executor,
        address indexed target,
        uint256 value,
        bytes returnData
    );

    error NotAdmin();
    error InvalidAdmin();
    error DuplicateAdmin(address admin);
    error InvalidThreshold();
    error ProposalDoesNotExist(uint256 proposalId);
    error ProposalAlreadyApproved(uint256 proposalId, address admin);
    error ProposalAlreadyExecuted(uint256 proposalId);
    error InsufficientApprovals(uint256 currentApprovals, uint256 thresholdRequired);
    error InsufficientBalance(uint256 available, uint256 required);
    error ExecutionFailed(bytes reason);

    modifier onlyAdmin() {
        if (!isAdmin[msg.sender]) {
            revert NotAdmin();
        }
        _;
    }

    modifier proposalExists(uint256 proposalId) {
        if (proposalId >= proposalCount) {
            revert ProposalDoesNotExist(proposalId);
        }
        _;
    }

    modifier notExecuted(uint256 proposalId) {
        if (s_proposals[proposalId].executed) {
            revert ProposalAlreadyExecuted(proposalId);
        }
        _;
    }

    constructor(address[] memory admins_, uint256 threshold_) payable {
        uint256 adminCount = admins_.length;
        if (adminCount == 0) {
            revert InvalidThreshold();
        }
        if (threshold_ == 0 || threshold_ > adminCount) {
            revert InvalidThreshold();
        }

        for (uint256 i = 0; i < adminCount; i++) {
            address admin = admins_[i];
            if (admin == address(0)) {
                revert InvalidAdmin();
            }
            if (isAdmin[admin]) {
                revert DuplicateAdmin(admin);
            }

            isAdmin[admin] = true;
            s_admins.push(admin);
        }

        threshold = threshold_;

        emit VaultInitialized(admins_, threshold_);

        if (msg.value > 0) {
            emit Deposit(msg.sender, msg.value, address(this).balance);
        }
    }

    receive() external payable {
        emit Deposit(msg.sender, msg.value, address(this).balance);
    }

    function getAdmins() external view returns (address[] memory) {
        return s_admins;
    }

    function createProposal(
        address target,
        uint256 value,
        bytes calldata data,
        string calldata description
    ) external onlyAdmin returns (uint256 proposalId) {
        if (target == address(0)) {
            revert InvalidAdmin();
        }

        proposalId = proposalCount;
        proposalCount++;

        Proposal storage proposal = s_proposals[proposalId];
        proposal.proposer = msg.sender;
        proposal.target = target;
        proposal.value = value;
        proposal.data = data;
        proposal.description = description;
        proposal.createdAt = block.timestamp;

        emit ProposalCreated(proposalId, msg.sender, target, value, data, description);
    }

    function approveProposal(
        uint256 proposalId
    ) external onlyAdmin proposalExists(proposalId) notExecuted(proposalId) {
        if (s_hasApproved[proposalId][msg.sender]) {
            revert ProposalAlreadyApproved(proposalId, msg.sender);
        }

        s_hasApproved[proposalId][msg.sender] = true;
        Proposal storage proposal = s_proposals[proposalId];
        proposal.approvalCount++;

        emit ProposalApproved(proposalId, msg.sender, proposal.approvalCount, threshold);
    }

    function executeProposal(
        uint256 proposalId
    )
        external
        onlyAdmin
        proposalExists(proposalId)
        notExecuted(proposalId)
        returns (bytes memory returnData)
    {
        Proposal storage proposal = s_proposals[proposalId];

        if (proposal.approvalCount < threshold) {
            revert InsufficientApprovals(proposal.approvalCount, threshold);
        }
        if (address(this).balance < proposal.value) {
            revert InsufficientBalance(address(this).balance, proposal.value);
        }

        proposal.executed = true;

        (bool success, bytes memory result) = proposal.target.call{value: proposal.value}(proposal.data);
        if (!success) {
            revert ExecutionFailed(result);
        }

        emit ProposalExecuted(proposalId, msg.sender, proposal.target, proposal.value, result);
        return result;
    }

    function getProposal(
        uint256 proposalId
    )
        external
        view
        proposalExists(proposalId)
        returns (
            address proposer,
            address target,
            uint256 value,
            bytes memory data,
            string memory description,
            uint256 approvalCount,
            bool executed,
            uint256 createdAt
        )
    {
        Proposal storage proposal = s_proposals[proposalId];
        return (
            proposal.proposer,
            proposal.target,
            proposal.value,
            proposal.data,
            proposal.description,
            proposal.approvalCount,
            proposal.executed,
            proposal.createdAt
        );
    }

    function hasApproved(uint256 proposalId, address admin) external view proposalExists(proposalId) returns (bool) {
        return s_hasApproved[proposalId][admin];
    }
}
