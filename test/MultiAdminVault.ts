import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.connect();

describe("MultiAdminVault", function () {
  it("stores admins and threshold on deployment", async function () {
    const [admin1, admin2, admin3] = await ethers.getSigners();
    const vault = await ethers.deployContract("MultiAdminVault", [
      [admin1.address, admin2.address, admin3.address],
      2n,
    ]);

    expect(await vault.threshold()).to.equal(2n);
    expect(await vault.isAdmin(admin1.address)).to.equal(true);
    expect(await vault.isAdmin(admin2.address)).to.equal(true);
    expect(await vault.isAdmin(admin3.address)).to.equal(true);
    expect(await vault.getAdmins()).to.deep.equal([
      admin1.address,
      admin2.address,
      admin3.address,
    ]);
  });

  it("creates proposals, tracks approvals, and executes after threshold", async function () {
    const [relayer, admin1, admin2, admin3, recipient] = await ethers.getSigners();
    const vault = await ethers.deployContract(
      "MultiAdminVault",
      [[admin1.address, admin2.address, admin3.address], 2n],
      { value: ethers.parseEther("1") },
    );

    const sendValue = ethers.parseEther("0.25");
    const proposalTx = await vault
      .connect(relayer)
      .createProposal(admin1.address, recipient.address, sendValue, "0x", "Treasury payout");
    await expect(proposalTx)
      .to.emit(vault, "ProposalCreated")
      .withArgs(0n, admin1.address, recipient.address, sendValue, "0x", "Treasury payout");

    await expect(vault.connect(relayer).approveProposal(0, admin1.address))
      .to.emit(vault, "ProposalApproved")
      .withArgs(0n, admin1.address, 1n, 2n);

    await expect(vault.connect(relayer).executeProposal(0, admin1.address)).to.be.revertedWithCustomError(
      vault,
      "InsufficientApprovals",
    );

    const recipientBalanceBefore = await ethers.provider.getBalance(recipient.address);

    await expect(vault.connect(relayer).approveProposal(0, admin2.address))
      .to.emit(vault, "ProposalApproved")
      .withArgs(0n, admin2.address, 2n, 2n);

    await expect(vault.connect(relayer).executeProposal(0, admin3.address))
      .to.emit(vault, "ProposalExecuted")
      .withArgs(0n, admin3.address, recipient.address, sendValue, "0x");

    const proposal = await vault.getProposal(0);
    const recipientBalanceAfter = await ethers.provider.getBalance(recipient.address);

    expect(proposal.executed).to.equal(true);
    expect(proposal.approvalCount).to.equal(2n);
    expect(recipientBalanceAfter - recipientBalanceBefore).to.equal(sendValue);
  });

  it("prevents duplicate approvals from the same admin", async function () {
    const [relayer, admin1, admin2] = await ethers.getSigners();
    const vault = await ethers.deployContract("MultiAdminVault", [
      [admin1.address, admin2.address],
      2n,
    ]);

    await vault.connect(relayer).createProposal(admin1.address, admin2.address, 0n, "0x", "No-op");
    await vault.connect(relayer).approveProposal(0, admin1.address);

    await expect(vault.connect(relayer).approveProposal(0, admin1.address)).to.be.revertedWithCustomError(
      vault,
      "ProposalAlreadyApproved",
    );
  });
});
