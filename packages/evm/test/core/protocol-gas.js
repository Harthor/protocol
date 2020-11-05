const { bigExp } = require('@aragon/contract-helpers-test')
const { assertBn } = require('@aragon/contract-helpers-test/src/asserts')

const { printTable } = require('../helpers/utils/logging')
const { buildHelper } = require('../helpers/wrappers/protocol')
const { getVoteId, hashVote, oppositeOutcome, SALT, OUTCOMES } = require('../helpers/utils/crvoting')

const Arbitrable = artifacts.require('ArbitrableMock')

contract('AragonProtocol', ([_, sender, drafter, appealMaker, appealTaker, guardian500, guardian1000, guardian1500, guardian2000, guardian2500, guardian3000]) => {
  let protocolHelper, disputeManager, voting, protocol, costs = {}

  const guardians = [
    { address: guardian500,  initialActiveBalance: bigExp(500,  18) },
    { address: guardian1000, initialActiveBalance: bigExp(1000, 18) },
    { address: guardian1500, initialActiveBalance: bigExp(1500, 18) },
    { address: guardian2000, initialActiveBalance: bigExp(2000, 18) },
    { address: guardian2500, initialActiveBalance: bigExp(2500, 18) },
    { address: guardian3000, initialActiveBalance: bigExp(3000, 18) }
  ]

  before('create protocol and activate guardians', async () => {
    protocolHelper = buildHelper()
    protocol = await protocolHelper.deploy()
    voting = protocolHelper.voting
    disputeManager = protocolHelper.disputeManager
    await protocolHelper.activate(guardians)
  })

  describe('gas costs', () => {
    const itCostsAtMost = (method, expectedCost, call) => {
      it(`should cost up to ${expectedCost.toLocaleString()} gas`, async () => {
        const { receipt: { gasUsed } } = await call()
        console.log(`gas costs: ${gasUsed.toLocaleString()}`)
        costs[method] = (costs[method] || []).concat(gasUsed.toLocaleString())
        assert.isAtMost(gasUsed, expectedCost)
      })
    }

    describe('createDispute', () => {
      let arbitrable

      beforeEach('create arbitrable and approve fee amount', async () => {
        await protocolHelper.setTerm(1)
        arbitrable = await Arbitrable.new(protocol.address)
        const { disputeFees } = await protocolHelper.getDisputeFees()
        await protocolHelper.mintFeeTokens(arbitrable.address, disputeFees)
      })

      context('when the current term is up-to-date', () => {
        beforeEach('assert needed transitions', async () => {
          const neededTransitions = await protocol.getNeededTermTransitions()
          assertBn(neededTransitions, 0, 'needed transitions does not match')
        })

        itCostsAtMost('createDispute', 288e3, () => arbitrable.createDispute(2, '0x', { from: sender }))
      })

      context('when the current term is outdated by one term', () => {
        beforeEach('assert needed transitions', async () => {
          await protocolHelper.increaseTimeInTerms(1)
          const neededTransitions = await protocol.getNeededTermTransitions()
          assertBn(neededTransitions, 1, 'needed transitions does not match')
        })

        itCostsAtMost('createDispute', 320e3, () => arbitrable.createDispute(2, '0x', { from: sender }))
      })
    })

    describe('draft', () => {
      let disputeId

      beforeEach('create dispute and advance to the draft term', async () => {
        disputeId = await protocolHelper.dispute()

        // Mock term randomness to make sure we always have the same output for the draft, otherwise this test won't be deterministic
        await protocolHelper.passRealTerms(1)
        await protocol.mockSetTermRandomness('0x0000000000000000000000000000000000000000000000000000000000000001')
      })

      itCostsAtMost('draft', 389e3, () => disputeManager.draft(disputeId))
    })

    describe('commit', () => {
      let voteId, draftedGuardians

      const vote = hashVote(OUTCOMES.LOW)

      beforeEach('create dispute and draft', async () => {
        const roundId = 0
        const disputeId = await protocolHelper.dispute()
        voteId = getVoteId(disputeId, roundId)
        draftedGuardians = await protocolHelper.draft({ disputeId, drafter })
      })

      context('when the current term is up-to-date', () => {
        beforeEach('assert needed transitions', async () => {
          const neededTransitions = await protocol.getNeededTermTransitions()
          assertBn(neededTransitions, 0, 'needed transitions does not match')
        })

        itCostsAtMost('commit', 107e3, () => voting.commit(voteId, draftedGuardians[0].address, vote, { from: draftedGuardians[0].address }))
      })

      context('when the current term is outdated by one term', () => {
        beforeEach('assert needed transitions', async () => {
          await protocolHelper.increaseTimeInTerms(1)
          const neededTransitions = await protocol.getNeededTermTransitions()
          assertBn(neededTransitions, 1, 'needed transitions does not match')
        })

        itCostsAtMost('commit', 168e3, () => voting.commit(voteId, draftedGuardians[0].address, vote, { from: draftedGuardians[0].address }))
      })
    })

    describe('reveal', () => {
      let voteId, draftedGuardians

      const outcome = OUTCOMES.LOW

      beforeEach('create dispute, draft and vote', async () => {
        const roundId = 0
        const disputeId = await protocolHelper.dispute()
        voteId = getVoteId(disputeId, roundId)

        // draft and commit
        draftedGuardians = await protocolHelper.draft({ disputeId, drafter })
        await protocolHelper.commit({ disputeId, roundId, voters: draftedGuardians })
      })

      context('when the current term is up-to-date', () => {
        beforeEach('assert needed transitions', async () => {
          const neededTransitions = await protocol.getNeededTermTransitions()
          assertBn(neededTransitions, 0, 'needed transitions does not match')
        })

        itCostsAtMost('reveal', 135e3, () => voting.reveal(voteId, draftedGuardians[0].address, outcome, SALT))
      })

      context('when the current term is outdated by one term', () => {
        beforeEach('assert needed transitions', async () => {
          await protocolHelper.increaseTimeInTerms(1)
          const neededTransitions = await protocol.getNeededTermTransitions()
          assertBn(neededTransitions, 1, 'needed transitions does not match')
        })

        itCostsAtMost('reveal', 196e3, () => voting.reveal(voteId, draftedGuardians[0].address, outcome, SALT))
      })
    })

    describe('createAppeal', () => {
      let disputeId, roundId = 0, appealMakerRuling

      beforeEach('create dispute, draft and vote', async () => {
        disputeId = await protocolHelper.dispute()
        const voteId = getVoteId(disputeId, roundId)

        // draft, commit, and reveal votes
        const draftedGuardians = await protocolHelper.draft({ disputeId, drafter })
        await protocolHelper.commit({ disputeId, roundId, voters: draftedGuardians })
        await protocolHelper.reveal({ disputeId, roundId, voters: draftedGuardians })

        // compute appeal ruling
        const winningRuling = await voting.getWinningOutcome(voteId)
        appealMakerRuling = oppositeOutcome(winningRuling)

        // mint appeal fees
        const { appealDeposit } = await protocolHelper.getAppealFees(disputeId, roundId)
        await protocolHelper.mintAndApproveFeeTokens(appealMaker, disputeManager.address, appealDeposit)
      })

      context('when the current term is up-to-date', () => {
        beforeEach('assert needed transitions', async () => {
          const neededTransitions = await protocol.getNeededTermTransitions()
          assertBn(neededTransitions, 0, 'needed transitions does not match')
        })

        itCostsAtMost('createAppeal', 109e3, () => disputeManager.createAppeal(disputeId, roundId, appealMakerRuling, { from: appealMaker }))
      })

      context('when the current term is outdated by one term', () => {
        beforeEach('assert needed transitions', async () => {
          await protocolHelper.increaseTimeInTerms(1)
          const neededTransitions = await protocol.getNeededTermTransitions()
          assertBn(neededTransitions, 1, 'needed transitions does not match')
        })

        itCostsAtMost('createAppeal', 170e3, () => disputeManager.createAppeal(disputeId, roundId, appealMakerRuling, { from: appealMaker }))
      })
    })

    describe('confirmAppeal', () => {
      let disputeId, roundId = 0, appealTakerRuling

      beforeEach('create dispute, draft, vote and appeal', async () => {
        disputeId = await protocolHelper.dispute()

        // draft, vote and appeal
        const draftedGuardians = await protocolHelper.draft({ disputeId, drafter })
        await protocolHelper.commit({ disputeId, roundId, voters: draftedGuardians })
        await protocolHelper.reveal({ disputeId, roundId, voters: draftedGuardians })
        await protocolHelper.appeal({ disputeId, roundId, appealMaker })

        // compute appeal confirmation ruling
        const { appealedRuling } = await protocolHelper.getAppeal(disputeId, roundId)
        appealTakerRuling = oppositeOutcome(appealedRuling)

        // mint appeal confirmation fees
        const { confirmAppealDeposit } = await protocolHelper.getAppealFees(disputeId, roundId)
        await protocolHelper.mintAndApproveFeeTokens(appealTaker, disputeManager.address, confirmAppealDeposit)
      })

      context('when the current term is up-to-date', () => {
        beforeEach('assert needed transitions', async () => {
          const neededTransitions = await protocol.getNeededTermTransitions()
          assertBn(neededTransitions, 0, 'needed transitions does not match')
        })

        itCostsAtMost('confirmAppeal', 194e3, () => disputeManager.confirmAppeal(disputeId, roundId, appealTakerRuling, { from: appealTaker }))
      })

      context('when the current term is outdated by one term', () => {
        beforeEach('assert needed transitions', async () => {
          await protocolHelper.increaseTimeInTerms(1)
          const neededTransitions = await protocol.getNeededTermTransitions()
          assertBn(neededTransitions, 1, 'needed transitions does not match')
        })

        itCostsAtMost('confirmAppeal', 255e3, () => disputeManager.confirmAppeal(disputeId, roundId, appealTakerRuling, { from: appealTaker }))
      })
    })

    describe('rule', () => {
      let disputeId

      beforeEach('create dispute, draft and vote', async () => {
        const roundId = 0
        disputeId = await protocolHelper.dispute()

        // draft, commit, and reveal votes
        const draftedGuardians = await protocolHelper.draft({ disputeId, drafter })
        await protocolHelper.commit({ disputeId, roundId, voters: draftedGuardians })
        await protocolHelper.reveal({ disputeId, roundId, voters: draftedGuardians })
        await protocolHelper.passTerms(protocolHelper.appealTerms)
      })

      context('when the current term is up-to-date', () => {
        beforeEach('assert needed transitions', async () => {
          const neededTransitions = await protocol.getNeededTermTransitions()
          assertBn(neededTransitions, 0, 'needed transitions does not match')
        })

        itCostsAtMost('rule', 95e3, () => protocol.rule(disputeId))
      })

      context('when the current term is outdated by one term', () => {
        beforeEach('assert needed transitions', async () => {
          await protocolHelper.increaseTimeInTerms(1)
          const neededTransitions = await protocol.getNeededTermTransitions()
          assertBn(neededTransitions, 1, 'needed transitions does not match')
        })

        itCostsAtMost('rule', 156e3, () => protocol.rule(disputeId))
      })
    })

    describe('settlePenalties', () => {
      let disputeId, roundId = 0

      beforeEach('create dispute, draft and vote', async () => {
        disputeId = await protocolHelper.dispute()

        // Mock term randomness to make sure we always have the same output for the draft, otherwise this test won't be deterministic
        await protocol.mockSetTermRandomness('0x0000000000000000000000000000000000000000000000000000000000000001')

        // draft, commit and reveal votes
        const draftedGuardians = await protocolHelper.draft({ disputeId, drafter })
        await protocolHelper.commit({ disputeId, roundId, voters: draftedGuardians })
        await protocolHelper.reveal({ disputeId, roundId, voters: draftedGuardians })
        await protocolHelper.passTerms(protocolHelper.appealTerms)
      })

      context('when the current term is up-to-date', () => {
        beforeEach('assert needed transitions', async () => {
          const neededTransitions = await protocol.getNeededTermTransitions()
          assertBn(neededTransitions, 0, 'needed transitions does not match')
        })

        itCostsAtMost('settlePenalties', 289e3, () => disputeManager.settlePenalties(disputeId, roundId, 0))
      })

      context('when the current term is outdated by one term', () => {
        beforeEach('assert needed transitions', async () => {
          await protocolHelper.increaseTimeInTerms(1)
          const neededTransitions = await protocol.getNeededTermTransitions()
          assertBn(neededTransitions, 1, 'needed transitions does not match')
        })

        itCostsAtMost('settlePenalties', 337e3, () => disputeManager.settlePenalties(disputeId, roundId, 0))
      })
    })

    describe('settleReward', () => {
      let disputeId, roundId = 0, draftedGuardians

      beforeEach('create dispute, draft and vote', async () => {
        disputeId = await protocolHelper.dispute()

        // draft, vote and settle penalties
        draftedGuardians = await protocolHelper.draft({ disputeId, drafter })
        draftedGuardians = draftedGuardians.map(guardian => ({ ...guardian, outcome: OUTCOMES.LOW }))
        await protocolHelper.commit({ disputeId, roundId, voters: draftedGuardians })
        await protocolHelper.reveal({ disputeId, roundId, voters: draftedGuardians })
        await protocolHelper.passTerms(protocolHelper.appealTerms)
        await disputeManager.settlePenalties(disputeId, roundId, 0)
      })

      context('when the current term is up-to-date', () => {
        beforeEach('assert needed transitions', async () => {
          const neededTransitions = await protocol.getNeededTermTransitions()
          assertBn(neededTransitions, 0, 'needed transitions does not match')
        })

        itCostsAtMost('settleReward', 110e3, () => disputeManager.settleReward(disputeId, roundId, draftedGuardians[0].address))
      })

      context('when the current term is outdated by one term', () => {
        beforeEach('assert needed transitions', async () => {
          await protocolHelper.increaseTimeInTerms(1)
          const neededTransitions = await protocol.getNeededTermTransitions()
          assertBn(neededTransitions, 1, 'needed transitions does not match')
        })

        itCostsAtMost('settleReward', 110e3, () => disputeManager.settleReward(disputeId, roundId, draftedGuardians[0].address))
      })
    })

    describe('settleAppealDeposit', () => {
      let disputeId, roundId = 0

      beforeEach('create dispute, draft and vote', async () => {
        disputeId = await protocolHelper.dispute()

        // draft, vote and appeal first round
        const draftedGuardians = await protocolHelper.draft({ disputeId, drafter })
        await protocolHelper.commit({ disputeId, roundId, voters: draftedGuardians })
        await protocolHelper.reveal({ disputeId, roundId, voters: draftedGuardians })
        await protocolHelper.appeal({ disputeId, roundId, appealMaker })
        await protocolHelper.confirmAppeal({ disputeId, roundId, appealTaker })

        // vote on second round
        const newRoundId = roundId + 1
        const newDraftedGuardians = await protocolHelper.draft({ disputeId, drafter })
        await protocolHelper.commit({ disputeId, roundId: newRoundId, voters: newDraftedGuardians })
        await protocolHelper.reveal({ disputeId, roundId: newRoundId, voters: newDraftedGuardians })
        await protocolHelper.passTerms(protocolHelper.appealTerms.add(protocolHelper.appealConfirmTerms))

        // settle first round penalties
        await disputeManager.settlePenalties(disputeId, roundId, 0)
      })

      context('when the current term is up-to-date', () => {
        beforeEach('assert needed transitions', async () => {
          const neededTransitions = await protocol.getNeededTermTransitions()
          assertBn(neededTransitions, 0, 'needed transitions does not match')
        })

        itCostsAtMost('settleAppealDeposit', 108e3, () => disputeManager.settleAppealDeposit(disputeId, roundId))
      })

      context('when the current term is outdated by one term', () => {
        beforeEach('assert needed transitions', async () => {
          await protocolHelper.increaseTimeInTerms(1)
          const neededTransitions = await protocol.getNeededTermTransitions()
          assertBn(neededTransitions, 1, 'needed transitions does not match')
        })

        itCostsAtMost('settleAppealDeposit', 93e3, () => disputeManager.settleAppealDeposit(disputeId, roundId))
      })
    })
  })

  after('print gas costs', () => {
    const parsedCosts = Object.keys(costs).map(method => [method].concat(costs[method]))
    printTable('Protocol gas costs', [['Function', 'Without heartbeat', 'With heartbeat'], ...parsedCosts])
  })
})
